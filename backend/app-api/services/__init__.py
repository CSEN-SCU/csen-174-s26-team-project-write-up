"""Firestore-backed user profile and preferences.

verify_google_token lives here too (Firebase Auth, not Firestore).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from errors import ApiError, safe_firestore
from firebase.init import ensure_firebase_app, get_db

USERS_COLLECTION = "users"
PREFERENCES_COLLECTION = "preferences"

DEFAULT_PREFERENCES: dict[str, Any] = {
    "focusAreas": [],
    "tonePreference": "neutral",
    "notifications": True,
}

ALLOWED_PREF_KEYS = frozenset(DEFAULT_PREFERENCES.keys())


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _raise_if_firestore_error(result: Any, err: ApiError | None) -> Any:
    if err is not None:
        raise err
    return result


def upsert_user(
    user_id: str,
    *,
    email: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    """Create or merge users/{user_id}. Returns the stored document fields."""

    def _write() -> dict[str, Any]:
        db = get_db()
        ref = db.collection(USERS_COLLECTION).document(user_id)
        snap = ref.get()
        now = _utc_now_iso()
        if snap.exists:
            existing = snap.to_dict() or {}
            patch: dict[str, Any] = {"userId": user_id, "updatedAt": now}
            if email is not None:
                patch["email"] = email
            if display_name is not None:
                patch["displayName"] = display_name
            ref.set(patch, merge=True)
            merged = {**existing, **patch}
            return merged

        payload = {
            "userId": user_id,
            "email": email if email is not None else "",
            "displayName": display_name if display_name is not None else "",
            "createdAt": now,
            "updatedAt": now,
        }
        ref.set(payload)
        return payload

    out, err = safe_firestore(_write)
    return _raise_if_firestore_error(out, err)


def get_user_profile(user_id: str) -> dict[str, Any]:
    """Return users/{user_id} fields or {} if missing."""

    def _read() -> dict[str, Any]:
        db = get_db()
        snap = db.collection(USERS_COLLECTION).document(user_id).get()
        if not snap.exists:
            return {}
        return dict(snap.to_dict() or {})

    out, err = safe_firestore(_read, fallback={})
    return _raise_if_firestore_error(out, err)


def get_user_preferences(user_id: str) -> dict[str, Any]:
    """Merge preferences/{user_id} onto DEFAULT_PREFERENCES."""

    def _read() -> dict[str, Any]:
        db = get_db()
        snap = db.collection(PREFERENCES_COLLECTION).document(user_id).get()
        merged = dict(DEFAULT_PREFERENCES)
        if snap.exists:
            data = snap.to_dict() or {}
            for key in ALLOWED_PREF_KEYS:
                if key in data and data[key] is not None:
                    merged[key] = data[key]
        return merged

    out, err = safe_firestore(_read, fallback=dict(DEFAULT_PREFERENCES))
    return _raise_if_firestore_error(out, err)


def update_user_preferences(user_id: str, prefs: dict[str, Any]) -> bool:
    """Merge-update preferences/{user_id}. Unknown keys -> ApiError 400."""

    if not isinstance(prefs, dict):
        raise ApiError("invalid_preferences", 400, "body must be an object")

    extra = set(prefs.keys()) - ALLOWED_PREF_KEYS
    if extra:
        raise ApiError(
            "invalid_preferences",
            400,
            f"unknown keys: {sorted(extra)}",
        )

    patch: dict[str, Any] = {
        k: v for k, v in prefs.items() if k in ALLOWED_PREF_KEYS and v is not None
    }
    if not patch:
        return True

    def _write() -> bool:
        db = get_db()
        now = _utc_now_iso()
        doc = {"userId": user_id, "updatedAt": now, **patch}
        db.collection(PREFERENCES_COLLECTION).document(user_id).set(doc, merge=True)
        return True

    out, err = safe_firestore(_write)
    _raise_if_firestore_error(out, err)
    return True


def verify_google_token(token: str) -> dict:
    """Verify a Firebase ID token; returns uid/email/name or raises ApiError."""
    from firebase_admin import auth as fb_auth

    ensure_firebase_app()
    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as exc:  # noqa: BLE001 - Firebase auth boundary
        raise ApiError("unauthenticated", 401, type(exc).__name__) from exc

    return {
        "uid": decoded["uid"],
        "email": decoded.get("email"),
        "name": decoded.get("name"),
    }
