from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from errors import safe_firestore
from firebase.init import get_db

bp = Blueprint("feedback_history", __name__)

COLLECTION = "feedback_history"
SCHEMA_VERSION = 1


def _clamp_confidence(value):
    """Coerce arbitrary input to a float in [0, 1]; missing/invalid -> 0.0."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    if f < 0.0:
        return 0.0
    if f > 1.0:
        return 1.0
    return f


def _envelope(items, *, degraded=False, error=None):
    """Build the standard list-response shape for /feedback-history GET."""
    payload = {
        "items": items,
        "totalCount": len(items),
        "schemaVersion": SCHEMA_VERSION,
    }
    if degraded:
        payload["degraded"] = True
        payload["error"] = error
    return payload


@bp.get("/feedback-history")
def history_list():
    doc_id_filter = request.args.get("docId")

    def _read():
        db = get_db()
        items = []
        for doc in db.collection(COLLECTION).stream():
            data = doc.to_dict()
            if doc_id_filter and data.get("docId") != doc_id_filter:
                continue
            items.append(data)
        return items

    items, err = safe_firestore(_read, fallback=[])
    if err is not None:
        return jsonify(_envelope(items, degraded=True, error=err.code)), 200
    return jsonify(_envelope(items)), 200


@bp.post("/feedback-history")
def history_add():
    body = request.get_json(silent=True) or {}
    user_id = body.get("userId")
    doc_id = body.get("docId")
    if not user_id or not doc_id:
        return jsonify(ok=False, error="missing_user_or_doc"), 400

    safe_card = body.get("cardId") or "default"
    history_id = f"{user_id}_{doc_id}_{safe_card}"

    record = {
        "userId": user_id,
        "docId": doc_id,
        "cardId": body.get("cardId"),
        "category": body.get("category"),
        "issue": body.get("issue"),
        "why": body.get("why"),
        "fixOptions": body.get("fixOptions"),
        "sources": body.get("sources"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    record = {k: v for k, v in record.items() if v is not None}
    # confidence is always present (defaulted + clamped) so the dashboard
    # can rely on a numeric score for every stored card.
    record["confidence"] = _clamp_confidence(body.get("confidence"))

    def _write():
        db = get_db()
        db.collection(COLLECTION).document(history_id).set(record)
        return True

    _, err = safe_firestore(_write)
    if err is not None:
        return jsonify(ok=False, error=err.code), err.status
    return jsonify(ok=True, historyId=history_id), 200
