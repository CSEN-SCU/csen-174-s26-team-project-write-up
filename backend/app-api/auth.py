"""Firebase ID token enforcement for Flask routes."""

import logging
import os
from functools import wraps

from flask import g, request

from errors import ApiError
from services import verify_google_token

log = logging.getLogger(__name__)

_DEV_BYPASS_ENVS = frozenset({"dev", "test"})


def _bypass_allowed() -> bool:
    auth_bp = os.environ.get("APP_AUTH_BYPASS", "").strip()
    env = os.environ.get("APP_ENV", "dev").strip().lower()
    return auth_bp == "1" and env in _DEV_BYPASS_ENVS


def require_auth(view):
    """Decorator: verify Firebase ID token; attach uid/email/name on flask.g.

    Dev-only bypass (never use in prod): set APP_AUTH_BYPASS=1 and APP_ENV to
    dev or test, then send X-Debug-User with a synthetic uid.
    """

    @wraps(view)
    def wrapped(*args, **kwargs):
        if _bypass_allowed():
            debug_uid = request.headers.get("X-Debug-User")
            if debug_uid:
                log.warning(
                    "APP_AUTH_BYPASS: trusting X-Debug-User=%s", debug_uid,
                )
                g.user_id = debug_uid.strip()
                g.user_email = request.headers.get("X-Debug-Email")
                g.user_name = request.headers.get("X-Debug-Name")
                return view(*args, **kwargs)
            raise ApiError(
                "missing_debug_user",
                401,
                "APP_AUTH_BYPASS is on: send header X-Debug-User (synthetic uid). "
                "If you use the extension against localhost, reload the extension after clearing a stale firebaseIdToken.",
            )

        header = request.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            raise ApiError(
                "missing_token",
                401,
                "Authorization: Bearer <id_token> required",
            )

        token = header.split(" ", 1)[1].strip()
        if not token:
            raise ApiError("missing_token", 401, "Empty Bearer token")

        try:
            user = verify_google_token(token)
        except ApiError:
            raise
        except Exception as exc:  # noqa: BLE001 - boundary
            log.warning("verify_id_token failed: %s", exc)
            raise ApiError(
                "unauthenticated",
                401,
                "Invalid or expired ID token",
            ) from exc

        g.user_id = user["uid"]
        g.user_email = user.get("email")
        g.user_name = user.get("name")
        return view(*args, **kwargs)

    return wrapped
