import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from routes.users import bp as users_bp
from routes.onboarding import bp as onboarding_bp
from routes.feedback_history import bp as history_bp
from routes.dismissals import bp as dismissals_bp
from routes.preferences import bp as prefs_bp
from routes.auth_google import bp as oauth_bp

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

app.register_blueprint(users_bp)
app.register_blueprint(onboarding_bp)
app.register_blueprint(history_bp)
app.register_blueprint(dismissals_bp)
app.register_blueprint(prefs_bp)
app.register_blueprint(oauth_bp)

@app.get("/health")
def health():
    return jsonify(ok=True, service="app-api")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    app.run(host="127.0.0.1", port=port, debug=True)
