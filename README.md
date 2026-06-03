# Write Up
Demo Video: https://youtu.be/N43Mmq7o4cc 

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