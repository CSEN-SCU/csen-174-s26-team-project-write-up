# Goal: Prepare app-api and coaching-api for deployment via Vercel

The backend for this project is split into app-api and coaching-api, both of which need separate Vercel deployments.

## Progress

### app-api
- [x] `firebase/init.py` — fixed broken imports, defined `FirebaseNotConfiguredError`, `_resolve_credentials_path`, `get_db()`
- [x] `app.py` — removed dev bypass, repo-root env load, limiter, Chrome extension CORS, deleted route blueprints; simplified CORS and error handlers
- [x] `auth.py` — removed bypass logic, `_DEV_BYPASS_ENVS`, `_bypass_allowed()`, `errors.ApiError`, `services.verify_google_token`; now calls `firebase_auth.verify_id_token` directly; returns JSON 401 tuples inline instead of raising exceptions
- [x] `routes/coach_proxy.py` — removed `limiter`, `errors.ApiError`, `extensions`, `flask_limiter`; removed `@limiter.limit` decorators, `_authenticated_user_limit_key`, rate limit string helpers, structured JSON proxy logging (`_log_coach_proxy_access`, `_coach_proxy_log_enabled`), `time`/`datetime` imports; `_forward_post` now returns error tuples inline instead of raising; `_force_uid_payload` simplified (removed mismatch warning)
- [x] `routes/documents.py` — removed `errors.safe_firestore`, `local_store`; stripped all `use_local_store()` branches; inlined Firestore calls directly in each route with plain `try/except`; removed inner `_read`/`_write` helper functions (only existed to support the `safe_firestore` pattern)
- [x] Delete files: removed `dev_defaults.py`, `local_store.py`, `errors.py`, `extensions.py`, `routes/coaching_feedback_map.py`, `routes/feedback_history.py`; `routes/auth_google.py`, `google/`, and `scripts/` were already absent from the filesystem; test files kept
- [x] Fixed broken imports found in remaining routes (missed in step 4): `users.py` and `preferences.py` imported from non-existent `services` module — inlined Firestore calls directly; `dismissals.py` and `onboarding.py` imported `safe_firestore` from deleted `errors.py` — replaced with inline try/except
- [x] Created `api/index.py` (`from app import app as handler`) and `vercel.json`
- [x] Trimmed `requirements.txt`: removed `Flask-Limiter` (limiter deleted), `google-auth` and `google-auth-oauthlib` (Google OAuth deleted); kept `flask`, `flask-cors`, `python-dotenv`, `firebase-admin`

### coaching-api
- [x] Rewrite `load-env.js`: replaced 3-directory env walk and dev bypass with a single `dotenv.config()` pointing at this project's own `.env`
- [x] Hardcode config in `llm/index.js`: `GROQ_BASE`, `GROQ_MODEL`, `OPENAI_MODEL`, `LLM_TIMEOUT_MS` are now constants; removed all `COACH_LOG_LLM*` instrumentation and `log.js` import; simplified `resolveCoachLlmAttempts` (always Groq-first); removed `logContext` parameter from `coachWithChatCompletions`
- [x] Deleted: `llm/log.js`, `middleware/coach-rate-limit.js`; `integrations/` kept intact (source + test files kept for class use)
- [x] Fixed `paths.js`: `DATA_DIR` and `PROFILE_PATH` now use `os.tmpdir()` when `process.env.VERCEL` is set, fall back to local `data/` for dev; also fixed `coach/run-coach.js` (removed deleted `google-docs-mcp` import, replaced `resolveCoachDraftText` with direct `body.text` read, hardcoded `RAG_TOP_K=8` and `PAUSED_SUGGESTION_MAX=14`, removed `llmLogContext` argument)
- [x] Simplified `src/index.js`: removed deleted imports (`coach-rate-limit`, `llm/log.js`), removed `diagnosticsPayload()` and `GET /internal/diagnostics`, simplified `GET /` to one-liner JSON, removed rate limiter middleware from both routes, hardcoded `127.0.0.1:8787`, removed `requestId` extraction
- [x] Created `api/index.js` (Vercel serverless entrypoint): no Express; top-level `await loadKnowledge()` on cold start; inlines secret check with `crypto.timingSafeEqual`; reads body from stream; routes `GET /health`, `POST /coach`, `POST /dismiss` manually; 404 for everything else
- [x] Created `vercel.json` with `includeFiles: "knowledge/**"` (required so Vercel bundles the RAG markdown files — they're read via `fs.readFile` at runtime, not imported, so they must be explicitly included); updated `.env.example` to only the 3 real secrets
- [x] Cleaned `package.json`: removed `express-rate-limit` (deleted module) and `write-up: file:../..` (local repo path that cannot resolve on Vercel's build servers)

## app-api Goals

app-api is currently a Flask server serving Firebase-related routes. It needs to be rewritten into a serverless architecture.

Rewrite the directory completely to follow new design patterns:

- All env vars needed should be defined in this project's directory only — nothing loaded from the repo root or app-api siblings
- `firebase/init.py` is the source of truth for Firebase initialization. It defines `ensure_firebase_app()`, `get_db()`, `FirebaseNotConfiguredError`, and `_resolve_credentials_path()`. Use it as-is.
- Remove all mentions of "auth bypass" or dev-only behavior — `dev_defaults.py` exists solely for this purpose and should be deleted entirely
### Files deleted

These are either dev-only utilities or test infrastructure that don't belong in the rewrite:

- `dev_defaults.py` — dev auth bypass, explicitly unwanted
- `local_store.py` — dev-only in-memory store
- `errors.py` — overly specific error classes; use plain `ValueError` / HTTP status codes inline
- `scripts/` — dev utility, not needed
- `extensions.py` — check if only used by deleted files; delete if so
- `google/oauth.py` — Google OAuth is out of scope for this rewrite

### Routes to keep (core flow)

Of the 9 route modules, keep only these:

- `users.py` — user profile read/write
- `documents.py` — document CRUD
- `onboarding.py` — onboarding state
- `preferences.py` — user preferences
- `coach_proxy.py` — proxies to coaching-api (the main feature)
- `dismissals.py` — dismiss coaching feedback

Remove these (non-core or auth-system-specific):
- `auth_google.py` — Google OAuth, out of scope
- `coaching_feedback_map.py` — optional feature, adds complexity
- `feedback_history.py` — optional feature, adds complexity

### Vercel serverless entrypoint format (Python)

Vercel expects Python serverless functions to live in an `api/` directory. Each file exposes a single WSGI-compatible handler. The simplest pattern for Flask is to point Vercel at the Flask `app` object using the `@vercel/python` runtime:

```
api/
  index.py      ← imports `app` from the Flask app file; Vercel calls it as WSGI
```

`vercel.json` in this directory should look like:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

The Flask `app` object itself can live in `app.py` at the root of `app-api/`. Vercel will bundle everything in the project directory.

### Env vars to configure in Vercel (app-api)

At the end of the rewrite, report these to the user:

| Variable | Description |
|---|---|
| `FIREBASE_CREDENTIALS` | Firebase service account as an inline JSON string (paste the contents of `service-account.json`) |
| `COACHING_API_BASE_URL` | URL of the deployed coaching-api Vercel project |
| `COACHING_INTERNAL_SECRET` | Shared secret between app-api and coaching-api |
| `WEBAPP_BASE_URL` | Deployed webapp URL — used to set the CORS allowed origin |

---

## coaching-api Goals

coaching-api is an Express server that calls the Groq LLM. It also needs to be rewritten into a serverless architecture.

Rewrite the directory completely to follow new design patterns:

- All env vars needed should be defined in this project's directory only
- Several `.env.example` values can be hardcoded — see the table below
- Remove all mentions of "auth bypass" or dev-only behavior

### Env vars: hardcode vs. keep secret

From `.env.example`, hardcode these directly in JavaScript (they are configuration, not secrets):

| Variable | Hardcode value |
|---|---|
| `PORT` | Not needed in serverless — remove entirely |
| `GROQ_API_BASE` | `https://api.groq.com/openai/v1` |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `RAG_TOP_K` | `8` |
| `COACH_LLM` | `auto` |
| `COACHING_LISTEN_HOST` | Not needed in serverless — remove entirely |

Keep these as real env vars (secrets):

| Variable | Description |
|---|---|
| `COACHING_INTERNAL_SECRET` | Shared secret with app-api |
| `GROQ_API_KEY` | Groq API key |
| `OPENAI_API_KEY` | OpenAI API key (fallback LLM) |

Drop these entirely (out of scope for this rewrite):
- All `GOOGLE_DOCS_*` variables (`integrations/google-docs-mcp.js` kept on disk for class use but not called by any route)
- All `COACH_LOG_LLM*` variables (debug tooling)

### Known issues in the current code to fix during rewrite

1. **`load-env.js` walks up to the repo root** to layer `.env` files from 3 directories. In serverless, there is no repo root and no `app-api` sibling. Replace with a simple `dotenv.config()` that loads only this project's own `.env`. Also remove the dev auth bypass at the bottom of that file (`COACHING_INTERNAL_SECRET ??= "dev-local-..."`).

2. **`express-rate-limit` is stateful** — it stores request counts in process memory. In serverless, each function invocation may be a fresh process, so rate limits won't accumulate correctly. Remove `coach-rate-limit.js` entirely and the middleware usage in `index.js`.

3. **`loadKnowledge()` reads files from the `knowledge/` directory** at startup. `paths.js` uses `import.meta.url`-based resolution (correct). The files are explicitly included in the Vercel bundle via `includeFiles: "knowledge/**"` in `vercel.json` — without this, Vercel would not bundle them since they are read via `fs.readFile`, not imported.

### Vercel serverless entrypoint format (Node.js)

Vercel expects Node.js serverless functions in an `api/` directory. Each file exports a default handler:

```javascript
export default async function handler(req, res) { ... }
```

Create `api/index.js` that wires all routes inline (since there are only 3 routes: `POST /coach`, `POST /dismiss`, `GET /health`). Do not use Express in the serverless file — just handle `req.method` and `req.url` directly or use a minimal router.

`vercel.json` in this directory should look like:
```json
{
  "functions": {
    "api/index.js": {
      "includeFiles": "knowledge/**"
    }
  },
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

The `includeFiles` entry is required — `knowledge/*.md` files are read at runtime via `fs.readFile`, not statically imported, so Vercel won't bundle them without it.

### Env vars to configure in Vercel (coaching-api)

At the end of the rewrite, report these to the user:

| Variable | Description |
|---|---|
| `COACHING_INTERNAL_SECRET` | Must match the value set in app-api |
| `GROQ_API_KEY` | Groq API key |
| `OPENAI_API_KEY` | OpenAI API key (optional fallback) |

---

## Conventions

- Limit the number of comments — only use them when absolutely necessary
- No file should be longer than 300 lines; make logical splits where necessary
- This project is meant for learning by up-and-coming programmers. Prefer simplicity over industry-standard patterns, and briefly explain *why* a design decision was made when it's non-obvious
