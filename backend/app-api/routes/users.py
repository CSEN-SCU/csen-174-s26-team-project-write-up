from flask import Blueprint, g, jsonify

from auth import require_auth
from services import get_user_profile, upsert_user

bp = Blueprint("users", __name__)


@bp.get("/users/me")
@require_auth
def users_me():
    upsert_user(
        g.user_id,
        email=g.user_email,
        display_name=g.user_name,
    )
    return jsonify(user=get_user_profile(g.user_id)), 200
