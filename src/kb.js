// Single source of truth for the curated knowledge base.
//
// `legal_kb.json` (curated cites + issue modules) is always included in every
// draft. `recent_cases.json` (the larger, growing corpus of case digests added
// from packets and the case-finder) is ISSUE-FILTERED: only digests whose tags
// match the current matter's active issues are injected, so the prompt stays
// focused and bounded no matter how many cases accumulate.
import kbData from "../legal_kb.json";
import recentCases from "../recent_cases.json";

const cites = kbData.cites || {};
const modules = kbData.issueModules || [];

const resolveCite = (key) => cites[key] || key;

const citeLines = Object.values(cites)
  .map((c) => `- ${c}`)
  .join("\n");

const moduleBlocks = modules
  .map((m) => {
    const types = Array.isArray(m.caseType) ? m.caseType.join(", ") : m.caseType || "";
    const issues = Array.isArray(m.issues) ? m.issues.join(", ") : m.issues || "";
    const auth = Array.isArray(m.cites) ? m.cites.map(resolveCite).join("; ") : "";
    return [
      `[${m.id}] ${m.title}`,
      m.when ? `When it applies: ${m.when}` : null,
      types ? `Case type: ${types}` : null,
      issues ? `Issues: ${issues}` : null,
      m.strength ? `Strength: ${m.strength}` : null,
      m.posture ? `Posture: ${m.posture}` : null,
      auth ? `Authorities: ${auth}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  })
  .join("\n\n");

const RECENT = Array.isArray(recentCases) ? recentCases : [];

export const KB_META = {
  citeCount: Object.keys(cites).length,
  moduleCount: modules.length,
  recentCount: RECENT.length,
};

// Always-on curated core.
export const BUNDLED_KB = `CURATED CASE LIBRARY (${KB_META.citeCount} authorities — every citation below is verified and may be cited):
${citeLines}

ISSUE MODULES (${KB_META.moduleCount} — tactical analysis of recurring tenant-defense issues; mine these for the strongest on-point arguments and authority):
${moduleBlocks}`;

const PROCEEDING_TAGS = new Set(["nonpayment", "holdover", "both"]);

function renderCase(c) {
  const head = [c.dateFiled, c.court].filter(Boolean).join(" | ");
  const tags = Array.isArray(c.issues) && c.issues.length ? ` [issues: ${c.issues.join(", ")}]` : "";
  const posture = c.posture ? ` [${c.posture}]` : "";
  const hist = c.subsequentHistoryFlag ? ` (subsequent history: ${c.subsequentHistoryFlag})` : "";
  return `- ${head ? `(${head}) ` : ""}${c.cite || ""}${posture}${tags}${hist}\n  ${c.summary || ""}`;
}

// Issue-filtered slice of the recent-case corpus. Returns "" when nothing
// matches. Cases matching specific issue tags rank above proceeding-type-only
// matches; ties break by most recent. Capped to keep the prompt bounded.
export function recentCasesText(activeTags, { max = 35 } = {}) {
  const tagSet = new Set(activeTags || []);
  if (!tagSet.size || !RECENT.length) return "";

  const scored = [];
  for (const c of RECENT) {
    const tags = Array.isArray(c.issues) ? c.issues : [];
    const matched = tags.filter((t) => tagSet.has(t));
    if (!matched.length) continue;
    const specific = matched.filter((t) => !PROCEEDING_TAGS.has(t)).length;
    scored.push({ c, specific, date: c.dateFiled || "" });
  }
  if (!scored.length) return "";

  scored.sort((a, b) => b.specific - a.specific || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const chosen = scored.slice(0, max);

  return `RECENT DECISIONS MATCHING THIS MATTER'S ISSUES (${chosen.length} of ${RECENT.length} collected; these are leads — verify each is still good law before relying on it):
${chosen.map((s) => renderCase(s.c)).join("\n")}`;
}
