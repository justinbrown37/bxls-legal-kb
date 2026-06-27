// ---------------------------------------------------------------------------
// Ingest local case packets into recent_cases.json.
//
// Reads a folder of NY housing decisions (PDF / HTML / TXT, including nested
// subfolders), dedupes, asks Claude to summarize + tag each one in the shared
// vocabulary the drafter's issue-filter uses, and appends them to
// recent_cases.json. Re-running is safe — already-ingested cases are skipped.
//
// Usage (Windows PowerShell):
//   $env:ANTHROPIC_API_KEY="sk-ant-..."
//   node tools/ingest-packets.mjs "C:\\Users\\you\\Documents\\HousingCasePackets"
//
// Usage (macOS/Linux):
//   ANTHROPIC_API_KEY=sk-ant-... node tools/ingest-packets.mjs "/path/to/folder"
//
// Optional env:
//   MODEL          (default claude-sonnet-4-6; set claude-opus-4-8 for max quality)
//   MAX            (default 0 = no limit) cap how many new cases to add this run
//   REQUEST_DELAY  (default 700) ms between Claude calls
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const MAX = parseInt(process.env.MAX || "0", 10);
const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY || "700", 10);

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node tools/ingest-packets.mjs "<folder path>"');
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.error("Set ANTHROPIC_API_KEY first (see the header of this file).");
  process.exit(1);
}

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

// Canonical tags. Each case gets exactly one proceeding tag plus any issue tags.
const PROCEEDING = ["nonpayment", "holdover", "both"];
const ISSUE_TAGS = [
  "rent_demand", "predicate_notice", "habitability", "certificate_of_occupancy",
  "mdl_registration", "rent_stabilization", "overcharge", "hstpa", "late_fees",
  "standing_capacity", "service_jurisdiction", "laches", "subsidy_section8_fheps",
  "lihtc_recert", "mitchell_lama", "succession", "discovery", "procedure",
  "stipulation_enforcement", "nuisance_holdover", "cares_act", "attorneys_fees",
  "warrant_judgment", "illusory_tenancy", "good_cause_eviction",
];

// ---- file discovery --------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function slipKey(name) {
  const m = name.match(/(\d{4}_\d+)/);
  if (m) return m[1];
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
}

// Prefer a non-"copy" HTML/TXT (cheap to parse) over PDF.
function rank(path) {
  const ext = extname(path).toLowerCase();
  const isCopy = /copy/i.test(basename(path));
  let r = ext === ".html" || ext === ".htm" ? 0 : ext === ".txt" ? 1 : ext === ".pdf" ? 2 : 9;
  return r + (isCopy ? 100 : 0);
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&sect;/g, "§").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&#160;/g, " ").replace(/&[a-z]+;/gi, " ");
}
function stripHtml(html) {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

let pdfParse = null;
async function extractText(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".txt") return readFileSync(path, "utf8").replace(/\s+/g, " ").trim();
  if (ext === ".html" || ext === ".htm") return stripHtml(readFileSync(path, "utf8"));
  if (ext === ".pdf") {
    if (!pdfParse) {
      try {
        // Import the inner module directly; pdf-parse's index.js runs debug
        // test code under ESM import and would otherwise throw.
        pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      } catch (e) {
        throw new Error("pdf-parse not installed — run `npm install` first (it's in package.json).");
      }
    }
    const data = await pdfParse(readFileSync(path));
    return (data.text || "").replace(/\s+/g, " ").trim();
  }
  return "";
}

// ---- Claude summarize + tag ------------------------------------------------
async function triage(text, fileName, knownNames) {
  const prompt = `You are cataloguing a New York housing court decision for a tenant-defense attorney who defends residential NONPAYMENT and HOLDOVER summary proceedings in NYC Housing Court (Bronx). Summarize it for a knowledge base used to draft tenant pleadings.

If the decision is NOT useful to residential tenant defense (e.g., purely commercial, matrimonial, foreclosure, criminal, or an unrelated civil matter), set "relevant": false. If it duplicates one of the ALREADY-KNOWN cases below, set "duplicate": true.

FILE: ${fileName}

ALREADY KNOWN (set duplicate=true if this is clearly one of them):
${knownNames.slice(0, 220).join("; ")}

CHOOSE tags only from these:
- proceeding (exactly one): ${PROCEEDING.join(", ")}
- issues (any that fit): ${ISSUE_TAGS.join(", ")}
You may add one extra short snake_case issue tag if a key concept is missing from the list.

OPINION TEXT (may be truncated):
"""
${text.slice(0, 14000)}
"""

Return ONLY a JSON object (no markdown):
{
  "relevant": true | false,
  "duplicate": true | false,
  "cite": "full Bluebook-style citation, e.g. Smith v. Jones, 2025 NY Slip Op 50001(U) (Civ. Ct., Bronx County 2025)",
  "court": "court + judge, e.g. Civ. Ct., Bronx County (Hon. Jane Doe)",
  "dateFiled": "YYYY-MM-DD if determinable, else empty",
  "summary": "3-5 sentences: the holding and why it matters to NYC tenant defense. Be concrete; name key authorities the court relied on.",
  "issues": ["one proceeding tag", "plus issue tags"],
  "posture": "FAVORABLE | UNFAVORABLE | MIXED (from the tenant's perspective)",
  "subsequentHistoryFlag": "note if the opinion says it affirms/reverses/modifies/overrules another decision, else empty"
}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    });
    if (resp.status === 429 || resp.status === 529) {
      const wait = 2000 * Math.pow(2, attempt);
      console.warn(`  … ${resp.status} busy; waiting ${wait / 1000}s`);
      await SLEEP(wait);
      continue;
    }
    if (!resp.ok) {
      let detail = "";
      try { detail = JSON.stringify(await resp.json()); } catch (e) { detail = await resp.text().catch(() => ""); }
      throw new Error(`Anthropic HTTP ${resp.status}: ${String(detail).slice(0, 400)}`);
    }
    const data = await resp.json();
    const raw = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
    let t = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    return JSON.parse(t);
  }
  throw new Error("Anthropic kept returning 429/529");
}

// ---- main ------------------------------------------------------------------
async function main() {
  console.log(`Ingesting from: ${folder}\nModel: ${MODEL}\n`);

  const kb = JSON.parse(readFileSync(join(ROOT, "legal_kb.json"), "utf8"));
  let recent = [];
  try { recent = JSON.parse(readFileSync(join(ROOT, "recent_cases.json"), "utf8")); } catch (e) { recent = []; }
  if (!Array.isArray(recent)) recent = [];

  const haveIds = new Set(recent.map((c) => String(c.id)).filter(Boolean));
  const knownNames = [
    ...Object.values(kb.cites || {}).map((s) => String(s).split(",")[0]),
    ...recent.map((c) => String(c.cite || "").split(",")[0]),
  ].filter(Boolean);

  // group files by case, pick the best file per case
  const all = walk(folder).filter((p) => [".pdf", ".html", ".htm", ".txt"].includes(extname(p).toLowerCase()));
  const groups = new Map();
  for (const p of all) {
    const k = slipKey(basename(p));
    const g = groups.get(k) || [];
    g.push(p);
    groups.set(k, g);
  }
  for (const [k, g] of groups) g.sort((a, b) => rank(a) - rank(b));

  console.log(`Found ${all.length} files -> ${groups.size} unique cases. Already have ${haveIds.size}.\n`);

  let added = 0, skipped = 0, failed = 0;
  for (const [key, g] of groups) {
    if (haveIds.has(key)) { skipped++; continue; }
    if (MAX && added >= MAX) break;
    const path = g[0];
    const fname = basename(path);
    try {
      const text = await extractText(path);
      if (!text || text.length < 400) { console.warn(`  ~ skip (no text): ${fname}`); skipped++; continue; }
      const v = await triage(text, fname, knownNames);
      await SLEEP(REQUEST_DELAY);
      if (!v || !v.relevant || v.duplicate) { console.log(`  - skip (${v && v.duplicate ? "dup" : "not relevant"}): ${fname}`); skipped++; continue; }
      const entry = {
        id: key,
        cite: v.cite || fname.replace(/\.[a-z]+$/i, ""),
        court: v.court || "",
        dateFiled: v.dateFiled || "",
        summary: v.summary || "",
        issues: Array.isArray(v.issues) ? v.issues : [],
        posture: v.posture || "",
        subsequentHistoryFlag: v.subsequentHistoryFlag || "",
        source: "packet-ingest",
        addedBy: "ingest-packets",
        addedOn: new Date().toISOString().slice(0, 10),
      };
      recent.push(entry);
      haveIds.add(key);
      added++;
      console.log(`  + [${added}] ${entry.cite}`);
      // checkpoint every 10 so progress survives an interruption
      if (added % 10 === 0) writeFileSync(join(ROOT, "recent_cases.json"), JSON.stringify(recent, null, 2) + "\n");
    } catch (e) {
      failed++;
      console.warn(`  ! failed: ${fname} — ${String(e.message || e)}`);
    }
  }

  writeFileSync(join(ROOT, "recent_cases.json"), JSON.stringify(recent, null, 2) + "\n");
  console.log(`\nDone. Added ${added}, skipped ${skipped}, failed ${failed}. Total now ${recent.length}.`);
  console.log(`Review the diff, then: git add recent_cases.json && git commit -m "Ingest case packets" && git push`);
}

main().catch((e) => { console.error(e); process.exit(1); });
