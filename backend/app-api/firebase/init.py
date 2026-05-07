import json
import os

_db = None


def get_db():
    global _db
    if _db is not None:
        return _db
    import firebase_admin
    from firebase_admin import credentials, firestore

    raw_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "")
    if raw_json:
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw_json)))
    elif cred_path and os.path.isfile(cred_path):
        firebase_admin.initialize_app(credentials.Certificate(cred_path))
    else:
        firebase_admin.initialize_app()
    _db = firestore.client()
    return _db
