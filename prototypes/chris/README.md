# Chris prototype: Write Up web app + RAG coach

This folder holds a **runnable prototype**: a **React** single-page app that talks to a **local Node server**. The server performs lightweight RAG over writing-coaching markdown, then returns **voice-preserving suggestions** (patterns and small optional edits, not full rewrites).

It includes a per-user writing profile that learns recurring style, grammar, and punctuation patterns over time and uses those signals to curate feedback.

## What’s included

- **`web/`** — Vite + React UI: create documents, type with **autosave**, and receive **debounced live coaching** (same `POST /coach` pipeline as before).
- **`server/`** — Express API with TF–IDF retrieval over `server/knowledge/*.md`, document storage in `server/data/documents-store.json`, persistent user profiles in `server/data/profile-store.json`, heuristics, and optional **Groq** and/or **OpenAI** chat completion for coaching (same RAG context to the model).

## Quick start

### 1. Backend

```bash
cd prototypes/chris/server
npm install
copy ..\.env.example ..\.env
# Edit prototypes/chris/.env: set GROQ_API_KEY and/or OPENAI_API_KEY for LLM coaching (see .env.example)
npm start
```

Default API: `http://localhost:8787`.

### 2. Frontend (development)

In a second terminal:

```bash
cd prototypes/chris/web
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The dev server **proxies** `/api`, `/coach`, and `/health` to the backend.

### 3. Frontend (production-style: one port)

Build the web app, then open the backend root:

```bash
cd prototypes/chris/web
npm install
npm run build
cd ../server
npm start
```

Then browse to `http://localhost:8787/`.

## Using the app

1. Click **New document**.
2. Edit the title and body; changes **autosave** after a short pause.
3. After you have enough text, coaching **refreshes** while you pause typing (RAG retrieval + optional OpenAI). Suggestions appear in the right column; expand **Sources** to see retrieved chunks.

## Design intent (matches product vision)

- **Teach, don’t replace**: suggestions emphasize *why* something is unclear or repetitive; optional “micro-edit” lines are short phrasing hints, not mandatory rewrites.
- **Preserve voice**: server prompt discourages flattening dialect or spoken rhythm unless the user asks for a more formal register.
- **Learn over time**: each coaching request updates a user profile (`userId` is stored in the browser). The latest profile snapshot is shown in the coach panel.

## Coaching output format

`POST /coach` returns:

- `suggestions`: coaching cards (`pattern`, `coherence`, `clarity`, `grammar`, `punctuation`, `voice`)
- `profileSnapshot`: aggregated learning state for the current `userId`
- `retrievedChunks`: top RAG chunks used as teaching context

## Limitations (honest MVP)

- RAG is **small-scale** (TF–IDF over local markdown). Swap in embeddings + a vector DB when you scale.
- Live coaching is **debounced** to limit API load; it is not character-by-character streaming.
