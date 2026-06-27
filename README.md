# BxLS Pleading Drafter + Legal Knowledge Base

Tenant-defense pleading drafting assistant for Bronx Housing Court summary
proceedings (nonpayment + holdover), built for Bronx Legal Services.

**Attorney-in-the-loop:** every output is a DRAFT requiring independent legal
judgment, verification, and Shepardizing before filing.

## What's in this repo

| File | What it is |
|------|------------|
| `BxLS_PleadingDrafter.jsx` | The drafting app — a single-file React component. This is the source of truth. |
| `legal_kb.json` | The curated knowledge base: 124 citations + 50 issue modules. |

This GitHub repo is the **stable home / backup / version history** for both
files. Every change is tracked, so nothing is ever lost and you can always see
what changed and when.

## Important: GitHub stores it, but doesn't *run* it

GitHub is a filing cabinet, not a computer. It keeps the source safe and
versioned, but it does not run the app by itself. Today the app runs inside
**Claude.ai as an Artifact**, because it relies on the Claude Artifact runtime
(`window.storage`) to save your API key and knowledge base.

To use the latest version:

1. Open `BxLS_PleadingDrafter.jsx` here on GitHub.
2. Copy the whole file.
3. Paste it into a new Claude Artifact (ask Claude to "run this React component").
4. Enter your Anthropic API key once and paste your knowledge base once — both
   are saved to your Claude account and reused on every draft.

## Want a permanent web address instead of re-pasting?

The app can be turned into a real website with its own URL (e.g. on Vercel,
Netlify, or GitHub Pages) so you just visit a link — no pasting. That requires
a small code change (swapping the Claude-only `window.storage` for the browser's
own storage) plus a one-time deploy setup. See the "Deploy" notes / open an
issue if you want this set up.

## Roadmap / ideas

- Sync the embedded citation library with `legal_kb.json` so there's one source
  of truth instead of two.
- Standalone deployment (real URL, no re-pasting).
- Additional issue modules and document-intake improvements.
