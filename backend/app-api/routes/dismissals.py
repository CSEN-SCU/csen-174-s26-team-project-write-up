"""Persist user dismissals (Firestore) — complements coaching-api /dismiss profile updates."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from firebase.init import get_db

bp = Blueprint("dismissals", __name__)

COLLECTION = "dismissals"


@bp.post("/dismissals")
@require_auth
def dismissals_add():
    body = request.get_json(silent=True) or {}
    card_id = body.get("cardId")
    if not card_id:
        return jsonify(ok=False, error="missing_card"), 400

    sources = body.get("sources")
    if sources is not None and not isinstance(sources, list):
        return jsonify(ok=False, error="invalid_sources"), 400

    now = datetime.now(timezone.utc).isoformat()
    doc_id = f"{g.user_id}_{card_id}_{uuid.uuid4().hex[:12]}"
    record: dict = {
        "userId": g.user_id,
        "cardId": str(card_id).strip()[:200],
        "createdAt": now,
    }
    if body.get("category") is not None:
        record["category"] = body.get("category")
    if body.get("reason") is not None:
        record["reason"] = body.get("reason")
    if isinstance(sources, list):
        record["sources"] = sources

    try:
        get_db().collection(COLLECTION).document(doc_id).set(record)
        return jsonify(ok=True, id=doc_id), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
