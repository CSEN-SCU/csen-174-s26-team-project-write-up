from flask import Blueprint, jsonify

bp = Blueprint("onboarding", __name__)


@bp.post("/onboarding")
def onboarding_create():
    return jsonify(ok=False, stub=True), 501
