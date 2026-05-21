from flask import Blueprint, g, jsonify

from auth import require_auth
from firebase.init import get_db

bp = Blueprint("users", __name__)


@bp.get("/users/me")
@require_auth
def users_me():
    try:
        db = get_db()
        ref = db.collection("users").document(g.user_id)
        patch = {"userId": g.user_id}
        if g.user_email:
            patch["email"] = g.user_email
        if g.user_name:
            patch["displayName"] = g.user_name
        ref.set(patch, merge=True)
        snap = ref.get()
        return jsonify(user=snap.to_dict() or {}), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
