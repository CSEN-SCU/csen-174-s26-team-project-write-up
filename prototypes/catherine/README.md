# Write Up — Catherine prototype

Chrome extension (Manifest V3) plus a small Node API and SQLite database. It supports the product vision in `docs/product-vision.md`: **pedagogical** feedback (why a word is weak), **synonyms**, **definitions**, optional **sentence rewrites**, and a lightweight **“linguistic profile”** (term persistence stored per extension user id).

## What you get

- **Frontend:** `extension/` — popup (settings + triggers), content script (floating panel, optional `::highlight` ranges on `<textarea>`).
- **Backend:** `server/` — Express `POST /api/analyze`, `GET /api/profile/:userId`.
- **Database:** SQLite file at `server/data/writeup.sqlite` (created on first run).
- **AI:** **Groq** (OpenAI-compatible chat API, free tier) — key from [Groq Console](https://console.groq.com/keys).

### Google Docs and complex editors

Google’s editor often **does not expose real selection text** to `window.getSelection()` the way a normal webpage does (Grammarly can use deeper integrations). This prototype does three things:

1. **Analyze selection** — Injects into **all frames**, tries the selection string, then falls back to **visible document text** from the Kix DOM (`.kix-appview-editor` / `role="textbox"`) when selection is empty. That can mean **the whole visible doc** is analyzed, not only a highlight.
2. **Analyze clipboard** — Select text in the doc, press **Ctrl+C** (or **Cmd+C**), open the extension popup, click **Analyze clipboard**. This matches what you actually highlighted (requires **clipboardRead** permission).
3. **Analyze focused field** — On Docs, if the editor surface is detected, it uses the same **visible-body** text as a fallback.

Reload the extension after updates. For production-grade Docs support you’d use the **Google Docs API** with OAuth, which is out of scope for this prototype.

## Setup

1. **Environment**

   - Edit `prototypes/catherine/.env.catherine` and set **`GROQ_API_KEY`** (no space after `=`).
   - Optional: **`GROQ_MODEL`** (defaults to `llama-3.1-8b-instant` in `server/src/groq.js`; e.g. `llama-3.3-70b-versatile`).
   - Optional: change **`PORT`** (default `3847`). If you change it, update the extension **API base URL** in the popup and `host_permissions` in `extension/manifest.json` if needed.

2. **API server**

   ```bash
   cd prototypes/catherine/server
   npm install
   npm start
   ```

   Open `http://localhost:3847/` for the API info page. Use `GET /health` to confirm `hasGroqKey: true` after you set the key.

3. **Load the extension**

   - Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → `prototypes/catherine/extension`.

4. **Use**

   - Popup: **API base URL** (default `http://localhost:3847`), **Writing level**, **Save settings**.
   - **Right-click** selected text on almost any page (including Google Docs and NYT) → **Analyze with Write Up** — uses Chrome’s selection text (no copy step).
   - **Analyze selection** in the popup (or **Ctrl+Shift+Y** / **Cmd+Shift+Y**), **Analyze clipboard**, or **Analyze focused field** on a `<textarea>`.

## API contract

`POST /api/analyze` — body: `userId`, `text`, `writingLevel`, optional `sourceUrl`, optional `textAcquisition` (`selection` \| `clipboard` \| `google_doc_body` \| `focused_field`; the extension maps **right-click** to `selection` on the wire).

**Vocabulary issues are discovered only by Groq** from the passage and the chosen **writing level** (no hardcoded weak-word list). Response includes `items`, `heuristicHitCount` (always `0`, reserved), `vocabularySource: "ai"`, `usedAi`, `aiProvider`, optional `aiError`, optional `analysisHint` (mainly for full Google Doc body reads).

For **`google_doc_body`**, the prompt tells the model the text may include Docs UI and to skip menu-like tokens; results are lightly filtered server-side.

### Is the Google Docs API free?

Google’s **Docs API** is billed through **Google Cloud** like other APIs: there is a **free usage tier / monthly quota** for many projects, then pay-as-you-go if you exceed it. Exact limits change over time — see the official **[Google Docs API pricing](https://developers.google.com/workspace/docs/api/pricing)** and **[Google Cloud pricing](https://cloud.google.com/pricing)** pages.

Using the Docs API properly also means **OAuth consent**, a Cloud project, and handling tokens — it is the right long-term approach if you need “exactly what the user selected in the document,” similar to how serious integrations work.

## Groq limits / “AI: off”

If Groq returns **429** or auth errors, wait and retry, confirm **`GROQ_API_KEY`**, or try another **`GROQ_MODEL`**. Without a key, the API returns **no AI items** (empty `items`).

## Port already in use (`EADDRINUSE`)

```text
netstat -ano | findstr :3847
taskkill /PID <pid> /F
```

Or set `PORT=3848` in `.env.catherine` and match the extension URL + manifest `host_permissions`.

## Notes

- Only files under `prototypes/catherine/` belong to this prototype.
- **Gemini is removed** from this prototype; the server depends on **Groq only** for vocabulary diagnosis (plus SQLite for persistence).
