from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

_APP_DIR = Path(__file__).resolve().parent
load_dotenv(_APP_DIR / ".env")

from routes.coach_proxy import bp as coach_proxy_bp
from routes.dismissals import bp as dismissals_bp
from routes.documents import bp as documents_bp
from routes.feedback_history import bp as feedback_history_bp
from routes.onboarding import bp as onboarding_bp
from routes.preferences import bp as prefs_bp
from routes.users import bp as users_bp

logging.basicConfig(level=logging.INFO)

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
    raw = os.environ.get("APP_CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]

    origins: list[str] = []
    webapp = os.environ.get("WEBAPP_BASE_URL", "")
    origin = _origin_from_base_url(webapp) if webapp else None
    if origin:
        origins.append(origin)
    origins.append(_DOCS_APP_ORIGIN)

    extras = os.environ.get("APP_EXTRA_CORS_ORIGINS", "").strip()
    if extras:
        origins.extend(o.strip() for o in extras.split(",") if o.strip())

    return list(dict.fromkeys(origins))


app = Flask(__name__)
CORS(app, resources={r"/*": {
    "origins": _cors_allowed_origins(),
    "allow_headers": ["Authorization", "Content-Type", "X-Request-Id"],
    "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}})

app.register_blueprint(users_bp, url_prefix="/api")
app.register_blueprint(onboarding_bp, url_prefix="/api")
app.register_blueprint(dismissals_bp, url_prefix="/api")
app.register_blueprint(prefs_bp, url_prefix="/api")
app.register_blueprint(feedback_history_bp, url_prefix="/api")
app.register_blueprint(coach_proxy_bp)
app.register_blueprint(documents_bp, url_prefix="/api")


@app.get("/")
def _root():
    return jsonify(ok=True, service="app-api", health="/health")


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
    body: dict = {"ok": True, "service": "app-api"}
    if request.args.get("coach") == "1":
        base = os.environ.get("COACHING_API_BASE_URL", "http://127.0.0.1:8787").strip().rstrip("/")
        body["coaching_api_base_url"] = base
        body["coach_proxy_secret_configured"] = bool(os.environ.get("COACHING_INTERNAL_SECRET", "").strip())
        reachable = False
        try:
            req = Request(f"{base}/health", method="GET")
            with urlopen(req, timeout=2.0) as resp:
                reachable = int(resp.getcode() or 0) == 200
        except OSError:
            reachable = False
        body["coaching_api_reachable"] = reachable
    return jsonify(body)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    debug = os.environ.get("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes")
    app.run(host="127.0.0.1", port=port, debug=debug, threaded=True)
