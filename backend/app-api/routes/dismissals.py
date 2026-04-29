from flask import Blueprint, jsonify

bp = Blueprint("dismissals", __name__)


@bp.post("/dismissals")
def dismissals_add():
    return jsonify(ok=False, stub=True), 501
