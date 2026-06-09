# Write Up — Final Technical Report

**Team Write Up** · Miranda, Cole, Ishika, Catherine, Chris · Spring 2026

> **Course:** CSEN 174 — Software Engineering in the Age of AI · Santa Clara University  

---

## How to use this document

| Item | Location |
|------|----------|
| Live app | [https://csen-174-s26-team-project-write-up.vercel.app/](https://csen-174-s26-team-project-write-up.vercel.app/) |
| Demo video | https://youtu.be/N43Mmq7o4cc |
| Demo-night tag | https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/releases/tag/demo-night-2026 |
| Sprint board | [GitHub Project #18](https://github.com/orgs/CSEN-SCU/projects/18) |
| Architecture (W4 baseline) | [`docs/architecture.md`](docs/architecture.md) |
| Architecture retrospective (W8) | [`docs/architecture-retrospective.md`](docs/architecture-retrospective.md) |
| Product vision (W2) | [`product-vision.md`](product-vision.md) |
| Testing plan (W5) | [`docs/sprint-1-testing.md`](docs/sprint-1-testing.md) |
| CI/CD (W6) | [`docs/sprint-1-cicd.md`](docs/sprint-1-cicd.md) · [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| Security remediations (W7) | [`docs/sprint-2-remediations.md`](docs/sprint-2-remediations.md) · [`docs/sprint-2-retro.md`](docs/sprint-2-retro.md) |
| Sprint retros | [`docs/sprint-1-retro.md`](docs/sprint-1-retro.md) · [`docs/sprint-2-retro.md`](docs/sprint-2-retro.md) |

---

## 1. Product vision and evolution

**W2 summary (then):** Write Up is a learning-first writing coach for aspiring writers and students who need a map of linguistic blind spots—not instant typo fixes. Unlike Grammarly’s “fix it now” editor, the product was framed as a long-term tutor with a **Linguistic Profile**, pedagogical explanations, and (initially) adaptive practice—powered by Recursive Linguistic Diagnostics and generative practice ideas ([`product-vision.md`](product-vision.md)).

**Current summary (now):** The shipped prototype is a **web-first coaching workspace**: writers paste or draft text, pause for a full coaching pass, and receive deterministic grammar/mechanics cards plus higher-level coaching (coherence, tone, clarity) without the system rewriting their voice. History and profile preferences persist per authenticated user via Firebase. The Chrome extension and in-Google-Docs loop were **descoped** to deliver a complete, deployable MVP on schedule ([`docs/architecture-retrospective.md`](docs/architecture-retrospective.md)).

### Vision shifts (2–4 decisions)

| # | Trigger | Decision | Repo / artifact |
|---|---------|----------|-----------------|
| 1 | Persona & scope pressure | Drop standalone “adaptive exercises” from core MVP; emphasize **feedback + history** over generated drills | [`product-vision.md`](product-vision.md) (“Our Product” shift); [`docs/architecture-retrospective.md`](docs/architecture-retrospective.md) |
| 2 | Deploy failures (local OK, prod broken) | Move toward **Vercel-hosted webapp** and serverless-friendly API layout | Live URL in [`docs/sprint-1-cicd.md`](docs/sprint-1-cicd.md); [`vercel.json`](vercel.json) |
| 3 | Timeline & OAuth/Docs complexity | **Pause extension** as a release target; concentrate UX in [`webapp/`](webapp/) | [`docs/architecture-retrospective.md`](docs/architecture-retrospective.md) — “Removal of the Web Extension” |
| 4 | Mid-quarter coaching quality | Split **deterministic mechanics** (spelling, punctuation, etc.) from **RAG/LLM coaching** so grammar never depends on retrieval | [`backend/coaching-api/src/coach/run-coach.js`](backend/coaching-api/src/coach/run-coach.js), [`issue-categories.js`](backend/coaching-api/src/coach/issue-categories.js), [`mechanics-pipeline.js`](backend/coaching-api/src/coach/mechanics-pipeline.js) |

### Storyboard / persona tie-in

The Lydia storyboard ([`docs/storyboard-lydia.md`](docs/storyboard-lydia.md)) framed a student who needs **why**, not just **what** to change. The current product still serves that user on the **webapp Write page** ([`webapp/src/pages/Write.jsx`](webapp/src/pages/Write.jsx)) with Accept/Decline, issue-type tags, and optional micro-edits—but not yet in Google Docs without the extension.

---

## 2. Architecture evolution

### W4 — Initial intent (extension + split APIs)

Planned: Chrome MV3 extension reading Google Docs, **App API** (Flask/Firebase) for auth/history, **Coaching API** (Node/RAG/LLM), markdown knowledge base, Google OAuth.

![W4-style container diagram — see repo history](docs/architecture.md)

**Reference:** [`docs/architecture.md`](docs/architecture.md)

### W8 — Revised architecture (deployability + security)

Revisions documented in [`docs/architecture-retrospective.md`](docs/architecture-retrospective.md):

- **Serverless / Vercel** alignment for the React webapp.
- **Authenticated proxy:** browser → App API → Coaching API (internal secret), not public coaching port.

![W8 current context](docs/images/architecture-context-current.png)

![W8 current containers](docs/images/architecture-container-current.png)

### Final Architecture (deployability)

- **Extension deprioritized**; webapp becomes primary writer surface.

### Current — Code freeze (Spring 2026)

```text
Writer → Webapp (React/Vite) → App API (Flask) → Coaching API (Express)
                ↓                      ↓                    ↓
           Firebase auth/docs    Firebase store      RAG knowledge + LLM (optional)
```

**Narrative of major deltas**

| Change | Trigger | Implementation trace |
|--------|---------|----------------------|
| `/coach` proxy only | Red team: exposed coaching endpoints | [`backend/app-api/routes/coach_proxy.py`](backend/app-api/routes/coach_proxy.py), [`COACHING_INTERNAL_SECRET`](backend/coaching-api/src/middleware/internal-secret.js) — commits noted May 13 in [`docs/sprint-2-retro.md`](docs/sprint-2-retro.md) |
| Rate limit on coach | LLM cost / abuse | [`docs/sprint-2-remediations.md`](docs/sprint-2-remediations.md) — commit [`fe64b28`](https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/commit/fe64b2882a87992534931a5c5239757f58360e55) |
| Mechanics vs RAG split | False negatives when RAG empty; whimsical-text gate blanked long drafts | [`run-coach.js`](backend/coaching-api/src/coach/run-coach.js), [`mechanics-detect.js`](backend/coaching-api/src/coach/mechanics-detect.js) |
| Live coach debouncing | Typing vs paused passes | [`webapp/src/hooks/useLiveCoach.js`](webapp/src/hooks/useLiveCoach.js) |

**Repo links for architectural decisions (≥3)**

1. [`backend/app-api/routes/coach_proxy.py`](backend/app-api/routes/coach_proxy.py) — forces `userId` from Firebase token.  
2. [`backend/coaching-api/src/coach/run-coach.js`](backend/coaching-api/src/coach/run-coach.js) — orchestration: `finalizeMechanicsSuggestions` then RAG/LLM coaching merge.  
3. [`backend/coaching-api/src/rag/index.js`](backend/coaching-api/src/rag/index.js) — `retrieveForCoachingGuidance` (no spelling-augment bias).  

---

## 3. Current state of the prototype

### What it does today

- **Sign-in** (Firebase) and **document list** with autosave ([`webapp/src/pages/Write.jsx`](webapp/src/pages/Write.jsx), [`backend/app-api/routes/documents.py`](backend/app-api/routes/documents.py)).
- **Write page:** debounced save, ~2.2s pause → full coach pass; lighter typing polls ([`useLiveCoach.js`](webapp/src/hooks/useLiveCoach.js)).
- **Suggestions:** deterministic mechanics + coaching cards; Accept/Decline persisted ([`backend/app-api/routes/feedback_history.py`](backend/app-api/routes/feedback_history.py)).
- **Profile & history** ([`webapp/src/pages/Profile.jsx`](webapp/src/pages/Profile.jsx), [`History.jsx`](webapp/src/pages/History.jsx)).
- **Privacy policy** surface ([`webapp/src/pages/PrivacyPolicy.jsx`](webapp/src/pages/PrivacyPolicy.jsx)).

### What it does not do yet

- In-document coaching inside **Google Docs** (extension not in release path).
- Full **Linguistic Profile** dashboard from original W2 vision (signals collected; limited UI).
- Guaranteed **LLM** coaching without API keys (heuristics + Hunspell still run).

### Seams / known gaps

- [`prototypes/`](prototypes/) and legacy [`extension/`](extension/) remain for portfolio history ([`docs/architecture-retrospective.md`](docs/architecture-retrospective.md) tech debt).
- Some tests target extension paths while CI still runs extension Vitest ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- Precision tradeoffs: e.g. serial-list punctuation heuristics vs false positives ([`mechanics-detect.js`](backend/coaching-api/src/coach/mechanics-detect.js) `isSerialNounList`).

### Links

| Asset | Link |
|-------|------|
| Live URL | https://csen-174-s26-team-project-write-up.vercel.app/ |
| Demo video | https://youtu.be/N43Mmq7o4cc |
| Demo Night commit | https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/releases/tag/demo-night-2026 |

### Feature → entry points

| Feature | Entry point |
|---------|-------------|
| Live coaching request | [`webapp/src/lib/api.js`](webapp/src/lib/api.js) `coach()` → [`coach_proxy.py`](backend/app-api/routes/coach_proxy.py) → [`run-coach.js`](backend/coaching-api/src/coach/run-coach.js) |
| Mechanics detectors | [`heuristics.js`](backend/coaching-api/src/coach/heuristics.js), [`mechanics-pipeline.js`](backend/coaching-api/src/coach/mechanics-pipeline.js) |
| Suggestion merge / caps | [`merge-suggestions.js`](backend/coaching-api/src/coach/merge-suggestions.js) |
| Documents CRUD | [`documents.py`](backend/app-api/routes/documents.py) |

---

## 4. Engineering process: testing, security, deployment

### Testing

**Planned (W5):** Per-member unit tests + integration examples ([`docs/sprint-1-testing.md`](docs/sprint-1-testing.md)).

**Implemented (representative):**

- **Methodical example — coaching guardrails:** pure functions filter malformed cards, unknown types, and bogus quoted evidence before the UI ([`backend/coaching-api/src/coach/guardrails.test.js`](backend/coaching-api/src/coach/guardrails.test.js), [`guardrails.js`](backend/coaching-api/src/coach/guardrails.js)). This encodes “don’t show LLM hallucinations as spelling fixes.”
- **Mechanics regression corpus:** [`heuristics-regression.test.js`](backend/coaching-api/src/coach/heuristics-regression.test.js) drives `finalizeMechanicsSuggestions` on intentional typo text.
- **RAG independence:** [`rag-independence.test.js`](backend/coaching-api/src/coach/rag-independence.test.js) — mechanics survive empty coaching merge.
- **App API:** [`api_unit_test.py`](backend/app-api/api_unit_test.py), [`test_coach_proxy.py`](backend/app-api/test_coach_proxy.py).
- **Webapp:** [`webapp/src/lib/api.test.js`](webapp/src/lib/api.test.js).

**Not exhaustively tested:** E2E browser flows, full LLM contract tests in CI (keys via secrets), extension against live Google Docs.

**AI vs human**

| AI contributed | Human judgment |
|----------------|----------------|
| Bulk React page scaffolding, test boilerplate | Coach pipeline split, whimsical-text gate fix, security proxy model |
| Merge-conflict resolution hints ([`docs/sprint-1-retro.md`](docs/sprint-1-retro.md)) | Prompt constraints when AI over-built DB integration tests |

### Security

**Planned (W7):** Red-team style review of peer project informed our own checklist ([`docs/red-team-report-team-emailtriage.md`](docs/red-team-report-team-emailtriage.md) — methodology).

**Implemented:** Sprint 2 remediations ([`docs/sprint-2-retro.md`](docs/sprint-2-retro.md)):

| Finding | Fix | Trace |
|---------|-----|-------|
| Open coaching API | Internal secret + app-api proxy only | [`internal-secret.js`](backend/coaching-api/src/middleware/internal-secret.js), [`coach_proxy.py`](backend/app-api/routes/coach_proxy.py) — [commit `4fe60a6`](https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/commit/4fe60a61bec38e3642e6f3e56ce99bb984159c7a) |
| LLM abuse / cost | Rate limiting on `/coach` | [`docs/sprint-2-remediations.md`](docs/sprint-2-remediations.md) — [commit `fe64b28`](https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/commit/fe64b2882a87992534931a5c5239757f58360e55) |
| CORS / debug leakage | Restrict origins, disable debug in prod | *See May 13 pushes on `main` per sprint-2 retro* |

**AI vs human:** Cursor flagged generic OWASP patterns; team validated which issues applied to **our** Firebase + dual-API layout before merging.

### Deployment

**Planned (W6):** GitHub Actions on PRs + Vercel frontend ([`docs/sprint-1-cicd.md`](docs/sprint-1-cicd.md)).

**Implemented:**

- **CI on every PR to `main`:** Node 20, `npm ci`, Vitest for coaching-api + extension ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)); merged via [PR #67](https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/pull/67) (per sprint-1-cicd doc).
- **Production webapp:** Vercel build from [`webapp/`](webapp/) ([`vercel.json`](vercel.json)).
- **Local full stack:** `npm run dev:all` runs coaching-api, Flask app-api, Vite ([`package.json`](package.json)).

**AI vs human:** AI suggested workflow YAML; humans scoped secrets (Firebase public config vs service account) per [`docs/sprint-1-cicd.md`](docs/sprint-1-cicd.md).

---

## 5. Successes, setbacks, and what would change

*Source material: [`docs/sprint-1-retro.md`](docs/sprint-1-retro.md), [`docs/sprint-2-retro.md`](docs/sprint-2-retro.md), Sprint 3 commitments in sprint-2 retro.*

### Successes

1. **Recovered from merge-conflict integration (Sprint 1).** We tried simultaneous integration on one monorepo; conflicts were heavy, but paired resolution and Chris’s reconciliation kept `main` coherent ([`docs/sprint-1-retro.md`](docs/sprint-1-retro.md)). *Practice to keep: integrate early, assign merge buddies ([issue #29](https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/issues/29)).*

2. **Pivoted to deployable architecture (Sprint 2).** When Flask + frontend worked locally but failed live, we moved to Vercel and tightened API boundaries instead of demoing localhost only ([`docs/architecture-retrospective.md`](docs/architecture-retrospective.md), [`docs/sprint-2-retro.md`](docs/sprint-2-retro.md)).

3. **Closed red-team remediations in one push window.** Rate limits + internal auth landed with traceable commits ([`docs/sprint-2-remediations.md`](docs/sprint-2-remediations.md)).

### Setbacks

1. **Extension Chrome Web Store work did not ship.** Ishika completed OAuth and store listing work, but live Docs integration exceeded schedule; focus moved to webapp ([`docs/sprint-2-retro.md`](docs/sprint-2-retro.md)). *Missed signal: production-like E2E test on extension earlier in Sprint 2.*

2. **Mechanics pipeline appeared “off” while coaching worked.** Long drafts hit `isSemanticallyUnusualButValid` and skipped all detectors; coaching heuristics used a separate path—looked like “detectors disconnected” until we logged stages and fixed the gate ([`mechanics-detect.js`](backend/coaching-api/src/coach/mechanics-detect.js)). *Early signal: unit test on 2k-char mixed text.*

3. **AI-generated tests over-scoped.** Cursor produced DB integration tests when asked for a small unit check ([`docs/sprint-1-retro.md`](docs/sprint-1-retro.md)). *Fix: explicit “no new files / mock only” in prompts.*

### AI tools

Cursor accelerated MVPs (extension sidepanel, Firebase wiring, coach guardrails) and helped debug git rebase conflicts. We overrode AI when it flattened architecture into a single API, when it suggested deleting prototype folders before code freeze, and when it proposed logging full draft text in production—we replaced that with `COACH_LOG` JSON summaries ([`coach-log.js`](backend/coaching-api/src/coach/coach-log.js), [`backend/coaching-api/.env.example`](backend/coaching-api/.env.example)). Jolli was useful for docs after extra prompting but did not replace repo-first documentation ([`docs/sprint-1-retro.md`](docs/sprint-1-retro.md)).

---

## 6. Future work

| Priority | Item | Why | Effort |
|----------|------|-----|--------|
| 1 | Restore **Google Docs extension** with production E2E | Delivers original differentiator (in-context coaching) | Multi-sprint |
| 2 | **Linguistic Profile** UI | Closes gap to W2 vision; data partially in [`profile/`](backend/coaching-api/src/profile/) | ~1 sprint |
| 3 | Reduce punctuation false positives | Better list-vs-clause detection ([`mechanics-detect.js`](backend/coaching-api/src/coach/mechanics-detect.js)) | Days–week |
| 4 | E2E tests (Playwright) for Write + coach | Catches stale-card UI bugs ([`Write.jsx`](webapp/src/pages/Write.jsx) `isCardStale`) | ~1 week |
| 5 | **Research:** fair dialect handling in spellcheck | Hunspell bias vs AAVE / ESL fairness — product-vision constraint | Research |

---

## 7. Advice to future CSEN 174 teams

1. **Deploy to production by Sprint 2**, not demo week—our biggest rework came from “works on localhost” ([`docs/sprint-2-retro.md`](docs/sprint-2-retro.md)).  
2. **Walk the Kanban before writing the final report**—each card is a process receipt ([Project #18](https://github.com/orgs/CSEN-SCU/projects/18)).  
3. **When AI and heuristics coexist, log stage counts without user text**—we burned days on a silent gate ([`coach-log.js`](backend/coaching-api/src/coach/coach-log.js)).

*CSEN 174 · Spring 2026 · Santa Clara University · Course materials CC BY 4.0*
