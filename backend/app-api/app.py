from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from errors import ApiError
from routes.users import bp as users_bp
from routes.onboarding import bp as onboarding_bp
from routes.feedback_history import bp as history_bp
from routes.dismissals import bp as dismissals_bp
from routes.preferences import bp as prefs_bp
from routes.auth_google import bp as oauth_bp
from routes.coach_proxy import bp as coach_proxy_bp

logging.basicConfig(level=logging.INFO)

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
_cors_origins = _cors_allowed_origins()
CORS(app, resources={r"/*": {"origins": _cors_origins}})

app.register_blueprint(users_bp)
app.register_blueprint(onboarding_bp)
app.register_blueprint(history_bp)
app.register_blueprint(dismissals_bp)
app.register_blueprint(prefs_bp)
app.register_blueprint(oauth_bp)
app.register_blueprint(coach_proxy_bp)


@app.errorhandler(ApiError)
def _handle_api_error(err):
    return jsonify(ok=False, error=err.code, message=err.message), err.status


@app.errorhandler(404)
def _handle_404(_err):
    return jsonify(ok=False, error="not_found"), 404


@app.errorhandler(405)
def _handle_405(_err):
    return jsonify(ok=False, error="method_not_allowed"), 405


@app.errorhandler(Exception)
def _handle_unexpected(err):
    app.logger.exception("Unhandled exception in route: %s", err)
    return jsonify(ok=False, error="internal_error"), 500


@app.get("/health")
def health():
    return jsonify(ok=True, service="app-api")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    _d = os.environ.get("FLASK_DEBUG", "0").strip().lower()
    debug = _d in ("1", "true", "yes", "y", "on")
    app.run(host="127.0.0.1", port=port, debug=debug)
