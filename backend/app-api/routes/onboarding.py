from flask import Blueprint, jsonify

from auth import require_auth

bp = Blueprint("onboarding", __name__)


@bp.post("/onboarding")
@require_auth
def onboarding_create():
    return jsonify(ok=False, stub=True), 501
