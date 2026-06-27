# BxLS Pleading Drafter

Tenant-defense pleading drafting assistant for Bronx Housing Court summary
proceedings (nonpayment + holdover), built for Bronx Legal Services.

**Attorney-in-the-loop:** every output is a DRAFT requiring independent legal
judgment, verification, and Shepardizing before filing.

This is now a **standalone web app** (React + Vite) that can be deployed to a
real URL. It no longer depends on the Claude.ai Artifact runtime.

## What's in this repo

| Path | What it is |
|------|------------|
| `legal_kb.json` | **The single source of truth** for the knowledge base: 124 citations + 50 issue modules. Edit this to add/change cases. |
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

## Run it locally (optional)

```bash
npm install
npm run dev      # opens a local dev server
npm run build    # produces the deployable site in dist/
```

Then enter your Anthropic API key in the app's Settings (top right). The key is
stored only in your own browser.

## Deploy to Vercel (one-time setup)

1. Go to **vercel.com**, sign in with GitHub, and click **Add New → Project**.
2. Import the **`bxls-legal-kb`** repository.
3. Vercel auto-detects Vite. Leave the defaults and click **Deploy**.
4. You get a permanent URL (e.g. `bxls-legal-kb.vercel.app`).

After this, **every push to GitHub auto-deploys** — so when changes are pushed
(new cases, drafting improvements), the live site updates itself in ~1 minute.

### Password-protect the URL

In the Vercel project: **Settings → Deployment Protection → Vercel
Authentication / Password Protection** → turn it on and set a password. Anyone
visiting the URL must enter it.

> Note: the page password keeps the public out, but does not hide the Anthropic
> API key from someone already logged in (the key lives in the browser). That's
> fine for individual use. For a wider Bronx Legal Services rollout, add a small
> backend so the key never reaches the browser.

## Confidentiality note

Uploaded documents and the knowledge base are sent to the Anthropic API only
when you extract or draft. Confirm this is consistent with your office's
confidentiality and data-handling policy before using client records.

## Roadmap

- [x] Standalone deployable web app (real URL)
- [x] One source of truth (`legal_kb.json` bundled in)
- [ ] More cases / issue modules
- [ ] Drafting quality improvements
- [ ] (If rollout grows) backend to hide the API key
