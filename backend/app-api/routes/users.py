from flask import Blueprint, jsonify

bp = Blueprint("users", __name__)


@bp.get("/users/me")
def users_me():
    return jsonify(user=None, stub=True), 501
