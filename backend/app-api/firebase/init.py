import os

_db = None


def get_db():
    global _db
    if _db is not None:
        return _db
    import firebase_admin
    from firebase_admin import credentials, firestore

    cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "")
    if cred_path and os.path.isfile(cred_path):
        firebase_admin.initialize_app(credentials.Certificate(cred_path))
    else:
        firebase_admin.initialize_app()
    _db = firestore.client()
    return _db
