// Single source of truth for the curated knowledge base.
//
// `legal_kb.json` (at the repo root) is bundled into the app at build time and
// rendered into the plain-text block that the drafter sends to the model on
// every draft. To add or change cases/issue modules, edit legal_kb.json and
// push — the deploy rebuilds and the live app picks it up automatically. There
// is no second cite list to keep in sync.
import kbData from "../legal_kb.json";

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

export const KB_META = {
  citeCount: Object.keys(cites).length,
  moduleCount: modules.length,
};

export const BUNDLED_KB = `CURATED CASE LIBRARY (${KB_META.citeCount} authorities — every citation below is verified and may be cited):
${citeLines}

ISSUE MODULES (${KB_META.moduleCount} — tactical analysis of recurring tenant-defense issues; mine these for the strongest on-point arguments and authority):
${moduleBlocks}`;
