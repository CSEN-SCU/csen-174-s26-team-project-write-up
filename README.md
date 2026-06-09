# Write Up

**Learning-first writing coach** — paste a draft, pause for coaching, and get mechanics plus higher-level feedback without losing your voice.

| | |
|---|---|
| **Live app** | https://csen-174-s26-team-project-write-up.vercel.app/ |
| **Demo video** | https://youtu.be/N43Mmq7o4cc |
| **Technical report** | [`TECHNICAL_REPORT.md`](TECHNICAL_REPORT.md) |
| **Architecture** | [`docs/architecture.md`](docs/architecture.md) |

![Write Up — add screenshot or GIF here](webapp/logo.png)

## Run locally

```bash
npm run install:all
# Configure .env from .env.example, backend/app-api/.env.example, backend/coaching-api/.env.example, webapp/.env.example
npm run dev:all   # coaching-api :8787, app-api :5050, webapp :5173
```

See [`backend/app-api/README.md`](backend/app-api/README.md) and [`backend/coaching-api/.env.example`](backend/coaching-api/.env.example) for secrets (`COACHING_INTERNAL_SECRET` must match on both APIs).

---

## Repository layout

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

Environment templates:
- Global shared template: `.env.example`
- App API template: `backend/app-api/.env.example`
- Coaching API template: `backend/coaching-api/.env.example`
- Web app template: `webapp/.env.example`
- Extension template: `extension/.env.example`