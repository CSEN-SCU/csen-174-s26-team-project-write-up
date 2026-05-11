"""Public Firebase web config + token verify. Full Google OAuth server flow is not used — clients use Firebase Auth."""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from errors import ApiError
from services import verify_google_token

bp = Blueprint("auth_google", __name__)


def _public_firebase_config():
    """Keys safe to expose to browser/extension (same as Firebase client SDK config)."""
    return {
        "apiKey": os.environ.get("FIREBASE_WEB_API_KEY", "").strip(),
        "authDomain": os.environ.get("FIREBASE_WEB_AUTH_DOMAIN", "").strip(),
        "projectId": os.environ.get("FIREBASE_WEB_PROJECT_ID", "").strip(),
        "storageBucket": os.environ.get("FIREBASE_WEB_STORAGE_BUCKET", "").strip(),
        "messagingSenderId": os.environ.get("FIREBASE_WEB_MESSAGING_SENDER_ID", "").strip(),
        "appId": os.environ.get("FIREBASE_WEB_APP_ID", "").strip(),
        "measurementId": os.environ.get("FIREBASE_WEB_MEASUREMENT_ID", "").strip(),
    }


@bp.get("/auth/client-config")
def auth_client_config():
    """Return Firebase client config for webapp / extension (no secrets beyond public web API key)."""
    cfg = _public_firebase_config()
    if not cfg["apiKey"] or not cfg["projectId"]:
        return (
            jsonify(
                ok=False,
                error="server_not_configured",
                message="Set FIREBASE_WEB_* env vars on app-api (see .env.example).",
            ),
            503,
        )
    return jsonify(ok=True, firebase=cfg), 200


@bp.post("/auth/google")
def auth_google_verify_id_token():
    """Verify a Firebase ID token from the client (same check as protected routes)."""
    body = request.get_json(silent=True) or {}
    token = (body.get("idToken") or body.get("id_token") or "").strip()
    if not token:
        return jsonify(ok=False, error="missing_id_token"), 400
    try:
        user = verify_google_token(token)
    except ApiError as e:
        return jsonify(ok=False, error=e.code, message=e.message), e.status
    return (
        jsonify(
            ok=True,
            uid=user["uid"],
            email=user.get("email"),
            name=user.get("name"),
        ),
        200,
    )


@bp.get("/auth/google/callback")
def auth_google_callback():
    """Legacy placeholder — OAuth redirect flow is not implemented; use Firebase Auth."""
    return (
        jsonify(
            ok=False,
            error="not_implemented",
            message="Use Firebase Auth in the webapp or extension, then send Authorization: Bearer <idToken>.",
        ),
        404,
    )
