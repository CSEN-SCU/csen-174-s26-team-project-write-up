# Week 6 — GitHub Actions CI (write-up)

## Merged PR with a passing CI check 

After this workflow lands on `main`, open the repository’s **Pull requests** tab, find the merged PR that introduced `.github/workflows/ci.yml`, and link it here. The PR’s **Checks** tab should show the **CI** workflow green.

**Link:** `https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/pull/67`

## Secrets Handling

We store LLM provider credentials only in GitHub **Settings → Secrets and variables → Actions**, never in source or workflow literals. Repository secrets `OPENAI_API_KEY` and `GROQ_API_KEY` are passed into the test job with `${{ secrets.OPENAI_API_KEY }}` and `${{ secrets.GROQ_API_KEY }}`, which mirrors how `backend/coaching-api` reads those names at runtime. CI needs them only if a job step actually calls the providers; the current W5 Vitest run is unit-level, so missing secrets resolve to empty strings and tests still pass. Deployment environments (for example Fly, Railway, or Azure) keep their own copies of the same variable names in that host’s secret manager so production traffic never relies on GitHub’s store.

## Live URL

**Link:** 'https://csen-174-s26-team-project-write-up.vercel.app/'

## Deployment Screenshots



## Platfrom Decisions
