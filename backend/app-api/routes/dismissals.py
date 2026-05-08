from flask import Blueprint, jsonify

from auth import require_auth

bp = Blueprint("dismissals", __name__)


@bp.post("/dismissals")
@require_auth
def dismissals_add():
    return jsonify(ok=False, stub=True), 501
