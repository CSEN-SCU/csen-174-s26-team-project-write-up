# Testing MCP and Google Cloud integrations (Docs, tokens, Gmail notes)

This guide covers how to **manually verify** Google-backed flows used by Write Up: **Google Docs** (via the Docs API or an HTTP MCP-style bridge), **OAuth tokens**, and where **Gmail / other Google Cloud APIs** fit (mostly **not** wired in this repo yet).

---

## 1. What this repository actually implements

| Integration | Where | Purpose |
|-------------|--------|---------|
| **Google Docs text (MCP-style)** | `backend/coaching-api` | When the extension sends `use_mcp: true` and `doc_id`, coaching-api loads document text via **`GOOGLE_DOCS_ACCESS_TOKEN`** (Docs API) or **`GOOGLE_DOCS_MCP_BRIDGE_URL`** (HTTP POST bridge). |
| **Firebase / Google identity** | `backend/app-api`, webapp | Sign-in and Firestore use **Firebase** (Google-backed project). Not the Gmail API. |
| **Legacy prototype bridge** | `prototypes/ishika/server/app.py` | Full sample of `POST /api/mcp/call` + `GOOGLE_DOCS_ACCESS_TOKEN`; can be run alongside coaching-api as a **bridge URL**. |

**Gmail API**, **Google Chat**, **Cloud Pub/Sub**, etc. are **not** implemented in the main product code paths. To test them you use the **Google Cloud Console** and small standalone scripts or Postman; see §5.

---

## 2. Prerequisites (Google Cloud)

1. Create or select a **Google Cloud project**.
2. Enable **Google Docs API** (APIs & Services → Library → “Google Docs API” → Enable).
3. Configure the **OAuth consent screen** (External or Internal for your org).
4. Create **OAuth 2.0 Client ID** credentials:
   - **Web application** for OAuth Playground / local web redirects, or
   - **Desktop** for installed-app flows.
5. Add **scopes** you need at minimum:
   - `https://www.googleapis.com/auth/documents.readonly` — read Doc text (Write Up coaching path).

**Gmail** (if you later add it): enable **Gmail API** and a separate scope such as `https://www.googleapis.com/auth/gmail.readonly` — do **not** reuse the Docs token unless the same OAuth consent includes both scopes.

---

## 3. Get a short-lived Google Docs access token (quick test)

### Option A — OAuth 2.0 Playground (fastest for manual tests)

1. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the gear icon → check **“Use your own OAuth credentials”** → paste your **OAuth client ID** and **client secret** from GCP.
3. In the left list, find **Google Docs API v1** → select **`https://www.googleapis.com/auth/documents.readonly`** (or use “Input your own scopes” and paste that URL).
4. **Authorize APIs** → **Exchange authorization code for tokens**.
5. Copy **Access token** (expires in ~1 hour).

Put it in `backend/coaching-api/.env`:

```env
GOOGLE_DOCS_ACCESS_TOKEN=ya29...
```

Restart coaching-api. `curl -fsS -H "X-Coaching-Internal-Secret: $COACHING_INTERNAL_SECRET" http://127.0.0.1:8787/health` should show `"googleDocsAccessToken": true`.

### Option B — `gcloud` user credentials (CLI-oriented teams)

Use [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) or user login flows that yield an access token with the Docs scope. Point the resulting bearer token at `GOOGLE_DOCS_ACCESS_TOKEN` the same way.

---

## 4. End-to-end checks

### 4.1 Google Docs API directly (no Write Up)

Replace `DOC_ID` with a real file ID from the Doc URL (`/document/d/DOC_ID/`):

```bash
curl -sS -H "Authorization: Bearer $GOOGLE_DOCS_ACCESS_TOKEN" \
  "https://docs.googleapis.com/v1/documents/DOC_ID" | head -c 400
```

You should see JSON with a `body` and `content` array.

### 4.2 Coaching-api MCP resolution (local)

With app-api + coaching-api running and token set, call **app-api** coach proxy (same as extension), with a stable `userId` (bypass or real Firebase):

```bash
curl -sS -X POST "http://127.0.0.1:5050/coach" \
  -H "Content-Type: application/json" \
  -H "X-Debug-User: mcp-test-user" \
  -d "{\"userId\":\"ignored\",\"text\":\"\",\"use_mcp\":true,\"doc_id\":\"DOC_ID\",\"focus\":[\"clarity\"]}"
```

Expect `200` and a JSON body with `suggestions` / `feedback` populated from the **fetched** document text.

### 4.3 HTTP MCP bridge (optional)

If you run **`python prototypes/ishika/server/app.py`** (port 5050 by default — **change** coaching-api port or prototype port to avoid collision), you can instead point coaching-api at its bridge:

```env
GOOGLE_DOCS_MCP_BRIDGE_URL=http://127.0.0.1:5050/api/mcp/call
```

**Note:** the prototype server and main `app-api` both commonly use **5050**; run the prototype on another port (e.g. `PORT=5052`) or only use **Option A** (`GOOGLE_DOCS_ACCESS_TOKEN` on coaching-api).

Bridge contract: `POST` JSON `{ "name": "google_docs.get_document_text", "arguments": { "document_id": "<id>" } }` → JSON whose payload includes `documentText` or nested `result` text (see `extractTextFromMcpPayload` in `backend/coaching-api/src/integrations/google-docs-mcp.js`).

### 4.4 Chrome extension (live Google Doc)

1. Load the extension; open a **Google Doc**; enable **Live in Google Docs** in the side panel.
2. Enable **“Fetch text via Docs API / MCP”** in the side panel (under **Live in Google Docs**). That sets `docsLiveUseMcp` in `chrome.storage.local`.
3. Ensure coaching-api has **`GOOGLE_DOCS_ACCESS_TOKEN`** (or bridge URL) and you are authenticated to **app-api** (Bearer or dev bypass).
4. Type in the Doc; after debounce, status should show success or a clear error (token scope, 403, etc.).

---

## 5. Gmail and “other” Google Cloud services

| Goal | Suggested approach |
|------|--------------------|
| **Verify GCP project / billing** | Cloud Console → Project settings; enable only APIs you need. |
| **Test Gmail API** | Enable Gmail API → OAuth consent with Gmail readonly scope → Playground or a one-off `curl` to `gmail.googleapis.com/gmail/v1/users/me/profile` with Bearer token. **Do not** commit tokens. |
| **Email sending (transactional)** | Usually **SendGrid**, **Firebase Extensions**, or **GCP + Secret Manager** — not part of this repo. |
| **Secret storage** | Use **Secret Manager** or CI secrets for `GOOGLE_DOCS_ACCESS_TOKEN` in staging/prod; rotate often (short-lived tokens). |

---

## 6. Automated tests in CI

This repo includes **Vitest** unit tests for MCP text resolution (`backend/coaching-api/src/integrations/google-docs-mcp.test.js`) using **mocked `fetch`** — no real Google call in CI.

To add **live** integration tests later, use a **dedicated GCP test project**, a **service account** or **refresh-token** stored only in CI secrets, and a **non-public** document ID — keep them out of the main branch workflow until stable.

---

## 7. Related files

- `backend/coaching-api/src/integrations/google-docs-mcp.js` — resolution logic  
- `backend/coaching-api/src/coach/run-coach.js` — calls resolver before coaching  
- `extension/src/content/docs.js` — sends `use_mcp` + `doc_id`  
- `prototypes/ishika/server/app.py` — reference MCP bridge + Docs API parsing  

For Firebase and extension token sync, see **`docs/cross-platform-user-flow.md`** and **`docs/api-contracts.md`**.
