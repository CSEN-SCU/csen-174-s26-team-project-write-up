## app-api local setup

Install backend dependencies:

```bash
pip install -r requirements.txt
```

## Environments

Set `APP_ENV` to one of `dev` (default), `staging`, `prod`, or `test`.

Firebase credential lookup order (first match wins):

1. `FIREBASE_SERVICE_ACCOUNT_JSON_<ENV>` (e.g. `FIREBASE_SERVICE_ACCOUNT_JSON_DEV`)
2. `FIREBASE_CREDENTIALS_PATH_<ENV>`
3. `FIREBASE_SERVICE_ACCOUNT_JSON` (unsuffixed)
4. `FIREBASE_CREDENTIALS_PATH` (unsuffixed)
5. Application Default Credentials (ADC)

This lets dev, staging, and prod each use their own service account without code changes.

### Dev auth bypass

For local testing without real Firebase ID tokens, set:

```bash
APP_ENV=dev
APP_AUTH_BYPASS=1
```

Then send `X-Debug-User: <uid>` instead of `Authorization: Bearer <id_token>`. The bypass only activates when `APP_ENV` is `dev` or `test`. Never enable this in production.

### Coach proxy observability (with coaching-api)

- Set **`APP_COACH_PROXY_LOG=1`** on app-api to emit one JSON **INFO** line per successful upstream `POST /coach` or `POST /dismiss` (prefix `[coach-proxy]`). Fields include `requestId`, `upstreamStatus`, `durationMs`, and `userId`.
- Clients may send **`X-Request-Id`**; otherwise app-api generates one and forwards it to coaching-api as **`X-Request-Id`**.
- On coaching-api, set **`COACH_LOG_LLM=1`** (see `backend/coaching-api/.env.example`). LLM stderr lines (`[coach-llm]`) then include the same **`requestId`** and **`userId`** so you can join gateway timing with model request/response previews in your log viewer.

Environment options for Firebase credentials (same order as above; legacy short list):

1. `FIREBASE_SERVICE_ACCOUNT_JSON` (or env-suffixed variant) — raw JSON string (best for CI).
2. `FIREBASE_CREDENTIALS_PATH` (or env-suffixed variant) — path to a local JSON file (best for local dev).
3. ADC if unset.

Run locally:

```bash
python app.py
```

Verify service health:

```bash
curl http://127.0.0.1:5050/health
```

For GitHub Actions, use repository secrets such as `${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}` or per-env names like `${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON_DEV }}`.
