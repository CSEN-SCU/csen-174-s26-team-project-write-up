import json
import os

_db = None


def ensure_firebase_app():
    """Initialize Firebase Admin SDK once (needed for Auth verify_id_token)."""
    import firebase_admin
    from firebase_admin import credentials

    try:
        firebase_admin.get_app()
        return
    except ValueError:
        pass

    env_suffix = os.environ.get("APP_ENV", "dev").upper()

    raw_json = (
        os.environ.get(f"FIREBASE_SERVICE_ACCOUNT_JSON_{env_suffix}", "").strip()
        or os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    )
    cred_path = (
        os.environ.get(f"FIREBASE_CREDENTIALS_PATH_{env_suffix}", "")
        or os.environ.get("FIREBASE_CREDENTIALS_PATH", "")
    )
    if raw_json:
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw_json)))
    elif cred_path and os.path.isfile(cred_path):
        firebase_admin.initialize_app(credentials.Certificate(cred_path))
    else:
        firebase_admin.initialize_app()


def get_db():
    global _db
    if _db is not None:
        return _db
    ensure_firebase_app()
    from firebase_admin import firestore

    _db = firestore.client()
    return _db
