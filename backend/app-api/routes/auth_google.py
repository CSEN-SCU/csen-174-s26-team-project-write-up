from flask import Blueprint, jsonify

bp = Blueprint("auth_google", __name__)


@bp.post("/auth/google")
def auth_google():
    return jsonify(ok=False, stub=True), 501


@bp.get("/auth/google/callback")
def auth_google_callback():
    return jsonify(ok=False, stub=True), 501
