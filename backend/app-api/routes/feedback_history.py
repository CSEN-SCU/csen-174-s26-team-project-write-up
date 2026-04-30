from flask import Blueprint, jsonify

bp = Blueprint("feedback_history", __name__)


@bp.get("/feedback-history")
def history_list():
    return jsonify(items=[], stub=True), 501


@bp.post("/feedback-history")
def history_add():
    return jsonify(ok=False, stub=True), 501
