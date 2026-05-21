# Goal: Prepare app-api and coaching-api for deployment via Vercel

The backend for this project is split into app-api and coaching-api, both of which need separate Vercel deployments.

## app-api Goals

app-api is currently a Flask server serving Firebase-related routes. It needs to be rewritten into a serverless architecture.

Rewrite the directory completely to follow new design patterns:

- All env vars needed should be defined in this project's directory only — nothing loaded from the repo root or app-api siblings
- `firebase/init.py` is the source of truth for Firebase initialization, but it is currently **broken**: it references `os`, `json`, `_resolve_credentials_path`, and `FirebaseNotConfiguredError` without importing or defining them. Fix these before using it as reference.
- Remove all mentions of "auth bypass" or dev-only behavior — `dev_defaults.py` exists solely for this purpose and should be deleted entirely
- Tests are extra — if a test fails or is too much to refactor, simply delete it

### Files to delete outright

These are either dev-only utilities or test infrastructure that don't belong in the rewrite:

- `dev_defaults.py` — dev auth bypass, explicitly unwanted
- `local_store.py` — dev-only in-memory store
- `errors.py` — overly specific error classes; use plain `ValueError` / HTTP status codes inline
- `scripts/` — dev utility, not needed
- `extensions.py` — check if only used by deleted files; delete if so
- `google/oauth.py` — Google OAuth is out of scope for this rewrite
- All `test_*.py` and `api_unit_test.py` files

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
| `COACHING_API_URL` | Internal URL of the deployed coaching-api Vercel project |
| `COACHING_INTERNAL_SECRET` | Shared secret between app-api and coaching-api |

---

## coaching-api Goals

coaching-api is an Express server that calls the Groq LLM. It also needs to be rewritten into a serverless architecture.

Rewrite the directory completely to follow new design patterns:

- All env vars needed should be defined in this project's directory only
- Several `.env.example` values can be hardcoded — see the table below
- Remove all mentions of "auth bypass" or dev-only behavior
- Tests are extra — if a test fails or is too much to refactor, simply delete it

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
- All `GOOGLE_DOCS_*` variables and the `integrations/google-docs-mcp.js` file
- All `COACH_LOG_LLM*` variables (debug tooling)

### Known issues in the current code to fix during rewrite

1. **`load-env.js` walks up to the repo root** to layer `.env` files from 3 directories. In serverless, there is no repo root and no `app-api` sibling. Replace with a simple `dotenv.config()` that loads only this project's own `.env`. Also remove the dev auth bypass at the bottom of that file (`COACHING_INTERNAL_SECRET ??= "dev-local-..."`).

2. **`express-rate-limit` is stateful** — it stores request counts in process memory. In serverless, each function invocation may be a fresh process, so rate limits won't accumulate correctly. Remove `coach-rate-limit.js` entirely and the middleware usage in `index.js`.

3. **`loadKnowledge()` reads files from the `knowledge/` directory** at startup. In Vercel serverless, files bundled with your function are accessible via relative paths. This will work as-is, but file paths must be relative to the function file, not `process.cwd()`. Verify `paths.js` uses `import.meta.url`-based resolution (it does) — keep this pattern.

### Vercel serverless entrypoint format (Node.js)

Vercel expects Node.js serverless functions in an `api/` directory. Each file exports a default handler:

```javascript
export default async function handler(req, res) { ... }
```

Create `api/index.js` that wires all routes inline (since there are only 3 routes: `POST /coach`, `POST /dismiss`, `GET /health`). Do not use Express in the serverless file — just handle `req.method` and `req.url` directly or use a minimal router.

`vercel.json` in this directory should look like:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

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
