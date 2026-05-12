# API Contracts (v0)

## Shared Types
- `FeedbackCard`: `shared/types/feedback-card.js`
- `DismissEvent`: `shared/types/dismiss-event.js`

## Coaching API (`http://localhost:8787`)
Node service for RAG/LLM coaching. Intended to sit **behind** app-api in production (not called directly by browsers).

- `POST /coach` — JSON body: see `backend/coaching-api/src/coach/run-coach.js` (`text`, `userId`, optional `surface`, `focus`, …). **MCP / Google Docs:** with `use_mcp: true` and `doc_id`, `text` may be empty; coaching-api loads content using `GOOGLE_DOCS_ACCESS_TOKEN` or `GOOGLE_DOCS_MCP_BRIDGE_URL` (see `docs/mcp-google-cloud-testing.md`).
- `POST /dismiss` — JSON body includes `userId` and dismiss payload; updates coaching profile store.
- `GET /profile/:userId` — read-only profile snapshot for a user.

## App API (`http://localhost:5050`)
### Auth and user data
- `GET /auth/client-config` — **Public.** Returns Firebase web SDK config (`firebase` object) from `FIREBASE_WEB_*` env vars on app-api so the extension can align with the same project as the webapp.
- `POST /auth/google` — **No legacy OAuth.** JSON body `{ "idToken": "<Firebase ID token>" }`; verifies token and returns `{ ok, uid, email, name }` (same verification as protected routes).
- `GET /auth/google/callback` — **Not used** (404 + message); clients use Firebase Auth instead of a server OAuth redirect.
- `GET /users/me`
- `POST /onboarding` — **Authenticated.** JSON body may include `writingSample` (string), `goals`, `experienceLevel`; merges into Firestore `users/{uid}` (`onboardingComplete`, `onboardingAt`, etc.).
- `GET /feedback-history?docId=<id>`
- `POST /feedback-history`
- `POST /dismissals` — **Authenticated.** JSON: `cardId` (required), optional `category`, `reason`, `sources` (array); appends a row in Firestore `dismissals` (complements coaching-api profile dismiss).
- `GET /preferences`
- `PUT /preferences`

### Coach proxy (authenticated → coaching-api)
These routes require a **Firebase ID token** (`Authorization: Bearer <id_token>`), unless app-api is running in the documented dev-only bypass (`APP_AUTH_BYPASS` + `APP_ENV` — see root `.env.example`).

- `POST /coach` — Accepts the same JSON fields clients would send to coaching-api `POST /coach`. **`userId` in the body is ignored for authorization**: app-api **overwrites** `userId` with the verified uid before forwarding.
- `POST /dismiss` — Same auth and **`userId` overwrite**; forwards to coaching-api `POST /dismiss`.

## App API → Coaching API (server-to-server)
- Base URL: **`COACHING_API_BASE_URL`** on app-api (default `http://127.0.0.1:8787`; see root `.env.example` and `backend/app-api/.env.example`).
- Method: **`POST`** to `/coach` or `/dismiss` with `Content-Type: application/json`, `Accept: application/json`.
- **`X-Request-Id`**: forwarded from the client request when present; otherwise app-api generates one for the upstream call. Coaching-api threads this into opt-in **`COACH_LOG_LLM`** stderr JSON (`requestId` field) so logs align with app-api **`APP_COACH_PROXY_LOG`** lines (`[coach-proxy]` / `[coach-llm]`); see `backend/app-api/README.md`.
- Response: app-api returns coaching-api’s JSON body and HTTP status when the upstream response is JSON; network/timeout/non-JSON failures map to app-api errors (`coaching_upstream`, `coaching_timeout`, `coaching_bad_response`).

## Clients (webapp, extension)
- Call **app-api** `POST /coach` and `POST /dismiss` only, not coaching-api directly, so `userId` cannot be spoofed and a single auth layer applies.
- **`GET /auth/client-config`** (no auth): Firebase web SDK fields for aligning the extension with the same Firebase project (requires **`FIREBASE_WEB_*`** on app-api; mirror `VITE_FIREBASE_*` from the webapp).
