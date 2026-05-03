# from flask import Blueprint, jsonify

# bp = Blueprint("feedback_history", __name__)


# @bp.get("/feedback-history")
# def history_list():
#     return jsonify(items=[], stub=True), 501


# @bp.post("/feedback-history")
# def history_add():
#     return jsonify(ok=False, stub=True), 501


from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from firebase.init import get_db

bp = Blueprint("feedback_history", __name__)

COLLECTION = "feedback_history"


@bp.get("/feedback-history")
def history_list():
    try:
        db = get_db()
        col = db.collection(COLLECTION)
        doc_id_filter = request.args.get("docId")

        items = []
        for doc in col.stream():
            data = doc.to_dict()
            if doc_id_filter is not None and data.get("docId") != doc_id_filter:
                continue
            items.append(data)

        return jsonify(items=items), 200
    except Exception as exc:
        return (
            jsonify(ok=False, error="firestore_unavailable", detail=str(exc)),
            503,
        )


@bp.post("/feedback-history")
def history_add():
    body = request.get_json(silent=True) or {}
    user_id = body.get("userId")
    doc_id = body.get("docId")
    if not user_id or not doc_id:
        return jsonify(ok=False, error="missing_user_or_doc"), 400

    record = {
        "userId": user_id,
        "docId": doc_id,
        "cardId": body.get("cardId"),
        "category": body.get("category"),
        "issue": body.get("issue"),
        "why": body.get("why"),
        "fixOptions": body.get("fixOptions"),
        "sources": body.get("sources"),
        "confidence": body.get("confidence"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    record = {k: v for k, v in record.items() if v is not None}

    try:
        db = get_db()
        safe_card = body.get("cardId") or "default"
        firestore_doc_id = f"{user_id}_{doc_id}_{safe_card}"
        db.collection(COLLECTION).document(firestore_doc_id).set(record)
        return jsonify(ok=True), 200
    except Exception as exc:
        return (
            jsonify(ok=False, error="firestore_unavailable", detail=str(exc)),
            503,
        )
