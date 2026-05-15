import json
import os
from pathlib import Path

from errors import FirebaseNotConfiguredError

_db = None

# firebase/init.py -> parents[1] = app-api, parents[2] = repo root
_APP_API_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = Path(__file__).resolve().parents[2]


def _resolve_credentials_path(raw: str) -> str | None:
    """Resolve FIREBASE_CREDENTIALS_PATH against cwd, repo root, and app-api dir."""
    p = (raw or "").strip()
    if not p:
        return None
    path = Path(p).expanduser()
    candidates: list[Path] = []
    if path.is_absolute():
        candidates.append(path)
    else:
        norm = p.lstrip("./").replace("\\", "/")
        candidates.extend(
            [
                Path.cwd() / p,
                _REPO_ROOT / norm,
                _APP_API_ROOT / norm,
            ]
        )
    for c in candidates:
        try:
            if c.is_file():
                return str(c.resolve())
        except OSError:
            continue
    return None


def ensure_firebase_app():
    """Initialize Firebase Admin SDK once (needed for Auth verify_id_token)."""
    import firebase_admin
    from firebase_admin import credentials

    try:
        firebase_admin.get_app()
        return
    except ValueError:
        pass

    env_suffix = os.environ.get("APP_ENV", "dev").strip().upper()

    raw_json = (
        os.environ.get(f"FIREBASE_SERVICE_ACCOUNT_JSON_{env_suffix}", "").strip()
        or os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    )
    cred_path_raw = (
        os.environ.get(f"FIREBASE_CREDENTIALS_PATH_{env_suffix}", "")
        or os.environ.get("FIREBASE_CREDENTIALS_PATH", "")
    ).strip()

    if raw_json:
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw_json)))
        return

    resolved = _resolve_credentials_path(cred_path_raw)
    if resolved:
        firebase_admin.initialize_app(credentials.Certificate(resolved))
        return

    # Do not call initialize_app() with no args — that uses ADC and fails loudly
    # on laptops without gcloud application-default credentials.
    return


def get_db():
    global _db
    if _db is not None:
        return _db
    import firebase_admin

    ensure_firebase_app()
    try:
        firebase_admin.get_app()
    except ValueError as e:
        raise FirebaseNotConfiguredError(
            "Set FIREBASE_CREDENTIALS_PATH or FIREBASE_SERVICE_ACCOUNT_JSON "
            "(see .env.example). Firestore is optional for local /coach with APP_AUTH_BYPASS."
        ) from e

    from firebase_admin import firestore

    _db = firestore.client()
    return _db
