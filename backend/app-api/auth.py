"""Firebase ID token enforcement for Flask routes."""

import logging
from functools import wraps

from firebase_admin import auth as firebase_auth
from flask import g, jsonify, request

from firebase.init import ensure_firebase_app

log = logging.getLogger(__name__)


def require_auth(view):
    """Decorator: verify Firebase ID token and attach uid/email/name to flask.g."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            return jsonify(ok=False, error="unauthenticated", message="Authorization: Bearer <token> required"), 401

        token = header.split(" ", 1)[1].strip()
        if not token:
            return jsonify(ok=False, error="unauthenticated", message="Empty Bearer token"), 401

        try:
            ensure_firebase_app()
            decoded = firebase_auth.verify_id_token(token)
        except Exception as exc:
            log.warning("verify_id_token failed: %s", exc)
            return jsonify(ok=False, error="unauthenticated", message="Invalid or expired token"), 401

        g.user_id = decoded["uid"]
        g.user_email = decoded.get("email")
        g.user_name = decoded.get("name")
        return view(*args, **kwargs)

    return wrapped
