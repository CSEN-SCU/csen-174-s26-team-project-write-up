from flask import Blueprint, g, jsonify, request

from auth import require_auth
from services import get_user_preferences, update_user_preferences

bp = Blueprint("preferences", __name__)


@bp.get("/preferences")
@require_auth
def prefs_get():
    return jsonify(preferences=get_user_preferences(g.user_id)), 200


@bp.put("/preferences")
@require_auth
def prefs_put():
    body = request.get_json(silent=True) or {}
    update_user_preferences(g.user_id, body)
    return jsonify(ok=True), 200
