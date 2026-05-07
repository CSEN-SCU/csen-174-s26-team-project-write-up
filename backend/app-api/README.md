## app-api local setup

Install backend dependencies:

```bash
pip install -r requirements.txt
```

Environment options for Firebase credentials (priority order):

1. `FIREBASE_SERVICE_ACCOUNT_JSON` - raw service-account JSON string (best for CI).
2. `FIREBASE_CREDENTIALS_PATH` - path to a local JSON file (best for local dev).
3. Application Default Credentials (ADC) if both variables are unset.

Run locally:

```bash
python app.py
```

Verify service health:

```bash
curl http://127.0.0.1:5050/health
```

For GitHub Actions, use repository secret `${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}`.
