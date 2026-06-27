// ---------------------------------------------------------------------------
// Case-finder: pulls recent NY decisions relevant to NYC Housing Court
// tenant-defense practice from the CourtListener (Free Law Project) API, asks
// Claude to triage + summarize each one, and proposes additions to
// recent_cases.json. A GitHub Action runs this and opens a pull request; the
// attorney reviews/Shepardizes and merges. The curated legal_kb.json is never
// touched by this tool.
//
// Legality: uses the CourtListener open API (designed for programmatic access).
// NY court decisions are public record. No site scraping.
//
// Required env:
//   COURTLISTENER_TOKEN  - CourtListener API token
//   ANTHROPIC_API_KEY    - Anthropic API key (for triage/summarize)
// Optional env:
//   CASE_DAYS        (default 30)   how far back to look
//   MAX_CANDIDATES   (default 40)   cap opinions sent to Claude per run
//   MAX_ADDITIONS    (default 20)   cap new entries added per run
//   MIN_CONFIDENCE   (default 0.6)  relevance threshold (0-1)
//   MODEL            (default claude-opus-4-8)  set to claude-sonnet-4-6 to cut cost
//   PR_BODY_PATH     (default ./tools/.pr-body.md)  where to write the PR body
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

const CL_TOKEN = process.env.COURTLISTENER_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DAYS = parseInt(process.env.CASE_DAYS || "30", 10);
const MAX_CANDIDATES = parseInt(process.env.MAX_CANDIDATES || "40", 10);
const MAX_ADDITIONS = parseInt(process.env.MAX_ADDITIONS || "20", 10);
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || "0.6");
const MODEL = process.env.MODEL || "claude-opus-4-8";
const PR_BODY_PATH = process.env.PR_BODY_PATH || join(__dir, ".pr-body.md");

if (!CL_TOKEN) throw new Error("Missing COURTLISTENER_TOKEN");
if (!ANTHROPIC_KEY) throw new Error("Missing ANTHROPIC_API_KEY");

// Courts whose decisions bind or persuade Bronx Housing Court. Adjust slugs
// here if a run reports zero results for one of them.
const COURTS = [
  { id: "ny", label: "N.Y. Court of Appeals (binding statewide)" },
  { id: "nyappdiv", label: "App. Div. (1st Dept binds the Bronx)" },
  { id: "nyappterm", label: "App. Term (1st Dept binds Civil Court)" },
  { id: "nycivct", label: "N.Y.C. Civil/Housing Court (persuasive)" },
];

// Full-text searches across the core tenant-defense issues.
const QUERIES = [
  "rent demand RPAPL 711 fourteen day nonpayment",
  "predicate notice termination notice to cure holdover defective",
  "warranty of habitability rent abatement RPL 235-b",
  "certificate of occupancy multiple dwelling law 301 302 rent",
  "rent stabilization overcharge legal regulated rent",
  "HSTPA 2019 late fees additional rent summary proceeding",
  "standing capacity petitioner summary proceeding dismiss",
  "Section 8 CityFHEPS FHEPS subsidy tenant share arrears",
];

const ISSUE_TAGS = [
  "rent_demand", "predicate_notice", "habitability", "certificate_of_occupancy",
  "mdl_registration", "rent_stabilization", "overcharge", "hstpa", "late_fees",
  "standing_capacity", "service_jurisdiction", "laches", "subsidy_section8_fheps",
  "lihtc_recert", "mitchell_lama", "succession", "warrant_judgment", "discovery",
];

const clHeaders = { Authorization: `Token ${CL_TOKEN}`, "User-Agent": "tenant-defense-drafter-casefinder" };

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const CL_DELAY = parseInt(process.env.CL_DELAY_MS || "1500", 10);
let lastCl = 0;

// Throttled CourtListener fetch: spaces requests out and backs off on HTTP 429
// (their API rate-limits bursts).
async function clFetch(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = Math.max(0, CL_DELAY - (Date.now() - lastCl));
    if (wait) await SLEEP(wait);
    lastCl = Date.now();
    const resp = await fetch(url, { headers: clHeaders });
    if (resp.status === 429) {
      const ra = parseInt(resp.headers.get("retry-after") || "0", 10);
      const backoff = ra ? ra * 1000 : 2000 * Math.pow(2, attempt);
      console.warn(`  … 429 rate-limited; waiting ${Math.round(backoff / 1000)}s and retrying`);
      await SLEEP(backoff);
      continue;
    }
    return resp;
  }
  console.warn("  ! still rate-limited after retries; skipping this request");
  return { ok: false, status: 429, json: async () => ({}) };
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

async function clSearch(query, courtId, filedAfter) {
  const url = new URL("https://www.courtlistener.com/api/rest/v4/search/");
  url.searchParams.set("type", "o");
  url.searchParams.set("q", query);
  url.searchParams.set("court", courtId);
  url.searchParams.set("filed_after", filedAfter);
  url.searchParams.set("order_by", "dateFiled desc");
  url.searchParams.set("page_size", "10");
  const resp = await clFetch(url);
  if (!resp.ok) {
    console.warn(`  ! search failed (${courtId}, "${query.slice(0, 30)}…"): HTTP ${resp.status}`);
    return [];
  }
  const data = await resp.json();
  return data.results || [];
}

async function fetchOpinionText(clusterId) {
  const url = new URL("https://www.courtlistener.com/api/rest/v4/opinions/");
  url.searchParams.set("cluster", String(clusterId));
  url.searchParams.set("page_size", "1");
  const resp = await clFetch(url);
  if (!resp.ok) return "";
  const data = await resp.json();
  const op = (data.results || [])[0] || {};
  let text = op.plain_text || "";
  if (!text && op.html_with_citations) text = op.html_with_citations.replace(/<[^>]+>/g, " ");
  if (!text && op.html) text = op.html.replace(/<[^>]+>/g, " ");
  return (text || "").replace(/\s+/g, " ").trim();
}

function resultMeta(r) {
  const clusterId = r.cluster_id || r.cluster || (r.cluster && r.cluster.id) || r.id;
  const citation = Array.isArray(r.citation) ? r.citation.join(", ") : r.citation || "";
  return {
    clusterId,
    caseName: r.caseName || r.case_name || "",
    citation,
    dateFiled: r.dateFiled || r.date_filed || "",
    court: r.court || r.court_citation_string || r.court_id || "",
    url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : "",
  };
}

async function triage(meta, text, knownNames) {
  const prompt = `You are screening a New York court opinion for a tenant-defense attorney who defends residential NONPAYMENT and HOLDOVER summary proceedings in New York City Housing Court (Bronx). Decide whether this decision is useful to that practice and, if so, summarize it.

RELEVANT topics include: rent demands (RPAPL 711, 14-day demand, good-faith amount, non-rent charges), predicate/termination/cure notices, warranty of habitability and abatement, certificate of occupancy / Multiple Dwelling Law 301-302, HPD/DHCR registration, rent stabilization and overcharge, HSTPA 2019 changes, late fees / "additional rent", standing/capacity of the petitioner, service and jurisdiction defects, laches, subsidies (Section 8 / CityFHEPS / FHEPS), LIHTC recertification, Mitchell-Lama, succession, warrants/judgments, and discovery in summary proceedings. NOT relevant: commercial tenancies unrelated to these doctrines, criminal, matrimonial, personal injury, etc.

CASE: ${meta.caseName} ${meta.citation ? `(${meta.citation})` : ""} — ${meta.court} ${meta.dateFiled}

ALREADY IN THE KNOWLEDGE BASE (set "duplicate": true if this opinion is clearly one of these):
${knownNames.slice(0, 200).join("; ")}

OPINION TEXT (may be truncated):
"""
${text.slice(0, 12000)}
"""

Return ONLY a JSON object (no markdown, no backticks):
{
  "relevant": true | false,
  "duplicate": true | false,
  "confidence": 0.0,
  "cite": "Bluebook-style citation, e.g. Smith v. Jones, 80 Misc. 3d 123 (App. Term, 1st Dept 2025)",
  "court": "short court label, e.g. App. Term, 1st Dept",
  "summary": "2-4 sentences: the holding and why it matters to NYC tenant defense. Be concrete.",
  "issues": ["choose any that fit from: ${ISSUE_TAGS.join(", ")}"],
  "posture": "FAVORABLE | UNFAVORABLE | MIXED (from the tenant's perspective)",
  "subsequentHistoryFlag": "if the text says it affirms/reverses/modifies/overrules another decision, note that briefly; else empty string"
}`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) {
    console.warn(`  ! Claude triage failed: HTTP ${resp.status}`);
    return null;
  }
  const data = await resp.json();
  const raw = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
  let t = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

// --------------------------------------------------------------------------
async function main() {
  const filedAfter = isoDaysAgo(DAYS);
  console.log(`Case-finder: looking back to ${filedAfter} (${DAYS} days), model ${MODEL}`);

  const kb = JSON.parse(readFileSync(join(ROOT, "legal_kb.json"), "utf8"));
  let recent = [];
  try {
    recent = JSON.parse(readFileSync(join(ROOT, "recent_cases.json"), "utf8"));
  } catch (e) {
    recent = [];
  }
  if (!Array.isArray(recent)) recent = [];

  const seenClusters = new Set(recent.map((c) => String(c.clId)).filter(Boolean));
  const knownNames = [
    ...Object.values(kb.cites || {}).map((s) => String(s).split(",")[0]),
    ...recent.map((c) => String(c.cite || "").split(",")[0]),
  ].filter(Boolean);

  // 1) Gather + dedupe candidates from CourtListener.
  const candidates = new Map();
  for (const court of COURTS) {
    let courtCount = 0;
    for (const q of QUERIES) {
      const results = await clSearch(q, court.id, filedAfter);
      for (const r of results) {
        const meta = resultMeta(r);
        if (!meta.clusterId) continue;
        const key = String(meta.clusterId);
        if (seenClusters.has(key) || candidates.has(key)) continue;
        candidates.set(key, meta);
        courtCount++;
      }
    }
    console.log(`  ${court.id}: ${courtCount} new candidate(s)`);
  }

  let pool = [...candidates.values()].slice(0, MAX_CANDIDATES);
  console.log(`Triaging ${pool.length} candidate(s) (cap ${MAX_CANDIDATES})…`);

  // 2) Triage + summarize each with Claude.
  const additions = [];
  for (const meta of pool) {
    if (additions.length >= MAX_ADDITIONS) break;
    const text = await fetchOpinionText(meta.clusterId);
    if (!text || text.length < 400) continue; // skip image-only / empty
    const verdict = await triage(meta, text, knownNames);
    if (!verdict || !verdict.relevant || verdict.duplicate) continue;
    if ((verdict.confidence || 0) < MIN_CONFIDENCE) continue;
    additions.push({
      clId: meta.clusterId,
      cite: verdict.cite || `${meta.caseName}, ${meta.citation}`.trim(),
      court: verdict.court || meta.court,
      dateFiled: meta.dateFiled,
      summary: verdict.summary || "",
      issues: Array.isArray(verdict.issues) ? verdict.issues : [],
      posture: verdict.posture || "",
      subsequentHistoryFlag: verdict.subsequentHistoryFlag || "",
      url: meta.url,
      addedBy: "case-finder",
      addedOn: new Date().toISOString().slice(0, 10),
    });
    console.log(`  + ${verdict.cite || meta.caseName}`);
  }

  if (additions.length === 0) {
    console.log("No new relevant cases this run. Nothing to propose.");
    writeFileSync(PR_BODY_PATH, "No new cases found this run.\n");
    return;
  }

  // 3) Write the proposals + a human-readable PR body.
  const merged = [...additions, ...recent];
  writeFileSync(join(ROOT, "recent_cases.json"), JSON.stringify(merged, null, 2) + "\n");

  const body = [
    `## Proposed cases — ${additions.length} found (looking back ${DAYS} days)`,
    "",
    "Each is an authentic published decision pulled from CourtListener and triaged by Claude. **Verify each is still good law (Shepardize) before relying on it.** Edit or delete any that don't belong, then merge — merging deploys them into the app's knowledge base.",
    "",
    ...additions.map(
      (c, i) =>
        `### ${i + 1}. ${c.cite}\n` +
        `- **Court / date:** ${c.court || "?"} · ${c.dateFiled || "?"}\n` +
        `- **Posture (tenant):** ${c.posture || "?"}\n` +
        `- **Issues:** ${c.issues.join(", ") || "—"}\n` +
        (c.subsequentHistoryFlag ? `- **⚠ Subsequent history noted:** ${c.subsequentHistoryFlag}\n` : "") +
        `- **Summary:** ${c.summary}\n` +
        (c.url ? `- **Source:** ${c.url}\n` : "")
    ),
    "",
    "_Generated by the case-finder workflow. Not legal advice; attorney review required._",
  ].join("\n");
  writeFileSync(PR_BODY_PATH, body + "\n");
  console.log(`Wrote ${additions.length} proposal(s) to recent_cases.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
