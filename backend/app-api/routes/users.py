from datetime import datetime, timezone

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

        snap = ref.get()
        existing = snap.to_dict() or {} if snap.exists else {}

        now = datetime.now(timezone.utc).isoformat()
        patch = {"userId": g.user_id, "updatedAt": now}
        if g.user_email:
            patch["email"] = g.user_email
        if g.user_name:
            patch["displayName"] = g.user_name
        if not existing.get("createdAt"):
            patch["createdAt"] = now

        ref.set(patch, merge=True)
        return jsonify(user={**existing, **patch}), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
