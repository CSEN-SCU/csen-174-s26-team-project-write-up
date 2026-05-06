# Write Up

Product scaffold aligned to C4 Option B (`docs/architecture.md`):
- `backend/app-api` (Flask + Firebase integration)
- `backend/coaching-api` (Express + RAG + LLM)
- `extension` (Ishika-based Chrome MV3 UI)
- `webapp` (React + Vite for Cole)
- `shared` (contracts and design tokens for Miranda)

Ownership:
- Miranda: user stories and mockups, plus integration flow between `extension/` and `webapp/` (`docs/`, `shared/`)
- Cole: web app visuals and UI (`webapp/`)
- Ishika: extension visuals and UI (`extension/`)
- Catherine: database setup, management, and integration (`backend/app-api/`)
- Chris: RAG management, training, and integration (`backend/coaching-api/`)

## Deploying the webapp on Vercel

The Chrome **extension** is not served by Vercel; load `extension/` as an **unpacked extension** in Chrome. Vercel only hosts the **React webapp** in `webapp/`.

**Fixing a 404 on Vercel**

1. **Project → Settings → General → Root Directory** — set to `webapp` *or* leave the root as the repo and add a root `vercel.json` that runs `npm ci --prefix webapp`, `npm run build --prefix webapp`, and sets `outputDirectory` to `webapp/dist` (see below).
2. **SPA routing** — React Router needs every path to serve `index.html`. Add a `vercel.json` `rewrites` entry: `"source": "/(.*)"` → `"destination": "/index.html"` (Vercel still serves real files under `/assets/` first).
3. Redeploy after changing settings.

**Root `vercel.json` (monorepo — default: leave Root Directory empty in Vercel)**

The repo includes [vercel.json](vercel.json) at the root: install/build `webapp/`, output `webapp/dist`, SPA rewrite to `index.html`.

**`webapp/vercel.json`** (if you instead set Vercel **Root Directory** to `webapp`)

[webapp/vercel.json](webapp/vercel.json) only adds the SPA rewrite; Vercel will run `npm run build` in that folder and use `dist` by default for Vite.

**Point the extension at your production URL**

1. In `extension/manifest.json`, under `host_permissions`, include your real origin if it is not `*.vercel.app` (for example a custom domain).
2. Under `content_scripts` → `matches` for `landing.js`, include that same origin so `#try` on the deployed landing page can message the extension.
3. In `extension/src/sidepanel/sidepanel.js`, point the home button at production: today `syncHomeLinkHref` uses the same base as the app API; split that so the **landing page** uses your Vercel URL (for example `https://your-team.vercel.app`) while `APP_API_BASE` / `COACH_API_BASE` can stay on localhost until the backends are deployed.

### After the webapp is stable on Vercel

1. **Vercel dashboard** — Confirm production URL, optional custom domain, and that deep links (`/onboarding`, etc.) load (SPA rewrite). Add **`VITE_*`** env vars in Vercel when the webapp needs public API base URLs at build time.
2. **Deploy backends** — Host `backend/app-api` and `backend/coaching-api` on a platform with a stable `https://` origin; configure secrets (DB, Firebase, LLM keys) there, not in the repo.
3. **CORS** — Allow your Vercel origin (and `chrome-extension://…` if required) on both APIs.
4. **Webapp API wiring** — Replace dev-only `/api` and `/coach` Vite proxies with real `fetch` URLs (from env) pointing at deployed backends.
5. **Extension** — Update `manifest.json` permissions and `sidepanel.js` (and any `fetch` bases) to match production webapp + API URLs; reload the unpacked extension after changes.
6. **Auth / cookies** — If you add login, decide how the extension and webapp share session or tokens with the same backend.
7. **CI** — Keep GitHub Actions green; optionally add a preview deploy or build check aligned with `main`.
