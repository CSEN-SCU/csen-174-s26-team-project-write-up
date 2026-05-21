import json
import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

_THIS_DIR = Path(__file__).resolve().parent

load_dotenv(_THIS_DIR.parent / ".env")


class FirebaseNotConfiguredError(Exception):
    pass


def _resolve_credentials_path(raw: str) -> str | None:
    if not raw:
        return None
    p = Path(raw)
    if not p.is_absolute():
        p = _THIS_DIR.parent / p
    return str(p) if p.exists() else None


def ensure_firebase_app() -> None:
    """Initialize Firebase Admin SDK once. Safe to call multiple times."""
    try:
        firebase_admin.get_app()
        return
    except ValueError:
        pass

    # 1. Try FIREBASE_CREDENTIALS as inline JSON (preferred for Vercel)
    raw_json = os.environ.get("FIREBASE_CREDENTIALS", "").strip()
    if raw_json:
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw_json)))
        return

    # 2. Try FIREBASE_CREDENTIALS_PATH as a path to a JSON file (preferred for local dev)
    cred_path_raw = os.environ.get("FIREBASE_CREDENTIALS_PATH", "").strip()
    resolved = _resolve_credentials_path(cred_path_raw)
    if resolved:
        firebase_admin.initialize_app(credentials.Certificate(resolved))
        return

    raise FirebaseNotConfiguredError(
        "Firebase credentials not found. Set FIREBASE_CREDENTIALS (JSON string) "
        "or FIREBASE_CREDENTIALS_PATH (path to JSON file) in your environment."
    )


def get_db():
    """Return a Firestore client, initializing Firebase if not already done."""
    ensure_firebase_app()
    return firestore.client()
