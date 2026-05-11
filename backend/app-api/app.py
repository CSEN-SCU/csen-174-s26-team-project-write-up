import logging
import os
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

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

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
    app.run(host="127.0.0.1", port=port, debug=True)
