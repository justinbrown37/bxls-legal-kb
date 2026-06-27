# Tenant Defense Drafter

Tenant-defense pleading drafting assistant for Bronx Housing Court summary
proceedings (nonpayment + holdover).

**Attorney-in-the-loop:** every output is a DRAFT requiring independent legal
judgment, verification, and Shepardizing before filing.

This is a **standalone web app** (React + Vite) deployable to a real URL.

## What's in this repo

| Path | What it is |
|------|------------|
| `legal_kb.json` | **The single source of truth** for the knowledge base: cases + issue modules. Edit this to add/change cases. |
| `src/App.jsx` | The drafting app (UI + logic). |
| `src/kb.js` | Bundles `legal_kb.json` into the draft prompt. |
| `src/storage.js` | Saves the API key + optional notes in the browser. |
| `index.html`, `src/main.jsx`, `vite.config.js`, `package.json` | App scaffolding. |
| `vercel.json` | Tells Vercel how to build. |

## One source of truth

The knowledge base lives in **one place: `legal_kb.json`**. It is compiled into
the app at build time and fed to the model on every draft. To add a case or
issue module, edit `legal_kb.json` and push — the live site rebuilds and uses it
automatically. There is no second cite list to keep in sync.

## Document intake: two modes

- **Auto-detect** — drop in any PDFs from the case file; the model identifies
  what each document is and extracts the facts.
- **By document type** — one labeled slot per document, if you prefer to sort
  them yourself.

## Run it locally (optional)

```bash
npm install
npm run dev      # local dev server
npm run build    # builds the deployable site into dist/
```

Enter your Anthropic API key in the app's Settings (top right). The key is
stored only in your own browser.

## Deploy to Vercel

1. **vercel.com** → sign in with GitHub → **Add New → Project**.
2. Import this repository. Vercel auto-detects Vite — accept defaults → **Deploy**.
3. Every push to the deployed branch auto-rebuilds the live site.

### Rename the URL

The default `*.vercel.app` URL comes from the Vercel project name. To change it:
Vercel project → **Settings → Domains** (add a new `*.vercel.app` name and set it
primary), or rename the project under **Settings → General**.

### Password-protect the URL

Vercel project → **Settings → Deployment Protection → Password Protection** →
turn on and set a password.

> The page password keeps the public out, but does not hide the Anthropic API
> key from someone already logged in (the key lives in the browser). Fine for
> individual use; for a wider rollout, add a small backend so the key never
> reaches the browser.

## Case-finder (proposes new cases for review)

A GitHub Action (`.github/workflows/find-cases.yml`) pulls recent NY decisions
relevant to NYC Housing Court tenant defense from the **CourtListener** open API
(public records; no site scraping), has Claude triage and summarize each one,
and opens a **pull request** proposing additions to `recent_cases.json`. You
review/Shepardize and merge the ones you want — merging deploys them into the
app's knowledge base, in a clearly-labeled "recently collected" section separate
from the hand-curated `legal_kb.json`.

**Setup (one-time):**
1. Add two repo secrets (Settings → Secrets and variables → Actions):
   `COURTLISTENER_TOKEN` and `ANTHROPIC_API_KEY`.
2. Enable Settings → Actions → General → Workflow permissions →
   **"Allow GitHub Actions to create and approve pull requests."**

**Run it:** Actions tab → **Find new cases** → **Run workflow** (set how many
days back). It runs on demand only; uncomment the `schedule` block in the
workflow file to make it weekly.

**Tuning:** edit `COURTS`, `QUERIES`, and the thresholds at the top of
`tools/find-cases.mjs`. Set the `model` input to `claude-sonnet-4-6` for lower
cost per run.

> These are authentic published decisions, but no free source is a citator —
> verify good-law status before relying on any of them in a filing.

## Confidentiality note

Uploaded documents and the knowledge base are sent to the Anthropic API only
when you extract or draft. Confirm this is consistent with your confidentiality
and data-handling obligations before using client records.
