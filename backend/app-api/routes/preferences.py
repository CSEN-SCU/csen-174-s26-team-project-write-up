from flask import Blueprint, g, jsonify, request

from auth import require_auth
from firebase.init import get_db

bp = Blueprint("preferences", __name__)


@bp.get("/preferences")
@require_auth
def prefs_get():
    try:
        snap = get_db().collection("users").document(g.user_id).get()
        data = snap.to_dict() or {} if snap.exists else {}
        return jsonify(preferences=data.get("preferences", {})), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500


@bp.put("/preferences")
@require_auth
def prefs_put():
    body = request.get_json(silent=True) or {}
    try:
        get_db().collection("users").document(g.user_id).set({"preferences": body}, merge=True)
        return jsonify(ok=True), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
