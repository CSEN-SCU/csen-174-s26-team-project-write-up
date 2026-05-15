from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

_APP_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _APP_DIR.parents[1]
load_dotenv(_REPO_ROOT / ".env")
load_dotenv(_APP_DIR / ".env", override=True)

from errors import ApiError
from extensions import limiter
from flask_limiter.errors import RateLimitExceeded
from routes.users import bp as users_bp
from routes.onboarding import bp as onboarding_bp
from routes.feedback_history import bp as history_bp
from routes.dismissals import bp as dismissals_bp
from routes.preferences import bp as prefs_bp
from routes.auth_google import bp as oauth_bp
from routes.coach_proxy import bp as coach_proxy_bp

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def _warn_if_extension_local_auth() -> None:
    """Surface misconfiguration: dev/test without bypass yields 401 for extension/Docs flows."""
    env = os.environ.get("APP_ENV", "dev").strip().lower()
    if env not in ("dev", "test"):
        return
    if os.environ.get("APP_AUTH_BYPASS", "").strip() == "1":
        return
    log.warning(
        "APP_AUTH_BYPASS is not 1: /coach and other protected routes need a Firebase Bearer token. "
        "For the Chrome extension or Google Docs without Sign in (web), set APP_AUTH_BYPASS=1 in the repo root .env and restart."
    )


# Content script on Google Docs calls app-api with the Docs page origin (see extension manifest).
_DOCS_APP_ORIGIN = "https://docs.google.com"


def _origin_from_base_url(url: str) -> str | None:
    base = url.strip().rstrip("/")
    if not base:
        return None
    if "://" not in base:
        base = f"http://{base}"
    parsed = urlparse(base)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _cors_allowed_origins() -> list[str]:
    """Explicit APP_CORS_ORIGINS wins; else WEBAPP_BASE_URL + docs + dev Vite + APP_EXTRA_CORS_ORIGINS."""
    raw = os.environ.get("APP_CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]

    origins: list[str] = []
    webapp = os.environ.get("WEBAPP_BASE_URL", "")
    origin = _origin_from_base_url(webapp) if webapp else None
    if origin:
        origins.append(origin)
    origins.append(_DOCS_APP_ORIGIN)

    if os.environ.get("APP_ENV", "dev").strip().lower() in ("dev", "test"):
        origins.extend(
            (
                "http://127.0.0.1:5173",
                "http://localhost:5173",
            )
        )

    extras = os.environ.get("APP_EXTRA_CORS_ORIGINS", "").strip()
    if extras:
        origins.extend(o.strip() for o in extras.split(",") if o.strip())

    return list(dict.fromkeys(origins))


app = Flask(__name__)
limiter.init_app(app)
_cors_origins = _cors_allowed_origins()
_cors_resource: dict = {
    "origins": _cors_origins,
    "allow_headers": [
        "Authorization",
        "Content-Type",
        "X-Debug-User",
        "X-Debug-Email",
        "X-Debug-Name",
        "X-Request-Id",
    ],
    "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}
# Side panel fetch uses Origin: chrome-extension://<id>; allow in dev/test only.
if os.environ.get("APP_ENV", "dev").strip().lower() in ("dev", "test"):
    _cors_resource = {
        **_cors_resource,
        "origins": list(_cors_origins)
        + [re.compile(r"^chrome-extension://[a-z]{32}$")],
    }
CORS(app, resources={r"/*": _cors_resource})

app.register_blueprint(users_bp)
app.register_blueprint(onboarding_bp)
app.register_blueprint(history_bp)
app.register_blueprint(dismissals_bp)
app.register_blueprint(prefs_bp)
app.register_blueprint(oauth_bp)
app.register_blueprint(coach_proxy_bp)
_warn_if_extension_local_auth()


@app.get("/")
def _root():
    """Default browser hit; routes omit /api on this server (Vite strips /api only in webapp dev)."""
    return jsonify(
        ok=True,
        service="app-api",
        health="/health",
        note="Paths are /users/me, /coach, /auth/client-config, ... (no /api/ prefix when calling Flask on port 5050; Vite strips /api in webapp dev).",
    )


@app.errorhandler(RateLimitExceeded)
def _handle_rate_limited(_err):
    return (
        jsonify(
            ok=False,
            error="rate_limited",
            message="Too many requests. Try again in a minute.",
        ),
        429,
    )


@app.errorhandler(ApiError)
def _handle_api_error(err):
    return jsonify(ok=False, error=err.code, message=err.message), err.status


@app.errorhandler(404)
def _handle_404(_err):
    p = request.path
    hint = None
    if p.startswith("/api/") and len(p) > len("/api/"):
        hint = f"Try {p[4:]} - app-api has no /api prefix (the webapp dev proxy strips /api before forwarding here)."
    body: dict = {"ok": False, "error": "not_found"}
    if hint:
        body["message"] = hint
    return jsonify(body), 404


@app.errorhandler(405)
def _handle_405(_err):
    return jsonify(ok=False, error="method_not_allowed"), 405


@app.errorhandler(Exception)
def _handle_unexpected(err):
    app.logger.exception("Unhandled exception in route: %s", err)
    return jsonify(ok=False, error="internal_error"), 500


@app.get("/health")
def health():
    body: dict = {"ok": True, "service": "app-api"}
    if request.args.get("coach") == "1":
        base = os.environ.get("COACHING_API_BASE_URL", "http://127.0.0.1:8787").strip().rstrip("/")
        body["coaching_api_base_url"] = base
        body["coach_proxy_secret_configured"] = bool(os.environ.get("COACHING_INTERNAL_SECRET", "").strip())
        reachable = False
        try:
            req = Request(f"{base}/health", method="GET")
            with urlopen(req, timeout=2.0) as resp:  # noqa: S310 - fixed URL from env default
                reachable = int(resp.getcode() or 0) == 200
        except OSError:
            reachable = False
        body["coaching_api_reachable"] = reachable
    return jsonify(body)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    _d = os.environ.get("FLASK_DEBUG", "0").strip().lower()
    debug = _d in ("1", "true", "yes", "y", "on")
    # Default dev server is single-threaded: one long POST /coach (e.g. Docs live + LLM)
    # blocks every other request, so the side panel appears hung and may not log POST /coach.
    app.run(host="127.0.0.1", port=port, debug=debug, threaded=True)
