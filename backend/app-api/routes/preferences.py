from flask import Blueprint, jsonify

bp = Blueprint("preferences", __name__)


@bp.get("/preferences")
def prefs_get():
    return jsonify(preferences=None, stub=True), 501


@bp.put("/preferences")
def prefs_put():
    return jsonify(ok=False, stub=True), 501
