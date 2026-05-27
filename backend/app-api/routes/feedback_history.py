"""Persist and fetch per-user feedback history entries in Firestore."""

from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from firebase.init import get_db

bp = Blueprint("feedback_history", __name__)

COLLECTION = "feedback_history"
USERS_COLLECTION = "users"
MAX_DOC_ID_CHARS = 200
MAX_CARD_ID_CHARS = 200
MAX_TEXT_CHARS = 4000
MAX_FIX_OPTIONS = 8
VALID_DECISIONS = {"accepted", "declined"}
LAST_COACHED_FIELD = "lastCoachedAt"


def _trim_text(value: object, limit: int = MAX_TEXT_CHARS) -> str:
    return str(value or "").strip()[:limit]


def _latest_rows(items: list[dict]) -> list[dict]:
    by_card: dict[str, dict] = {}
    for row in items:
        key = f"{row.get('docId', '')}::{row.get('cardId', '')}"
        prev = by_card.get(key)
        if not prev or str(row.get("updatedAt") or "") >= str(prev.get("updatedAt") or ""):
            by_card[key] = row
    return list(by_card.values())


@bp.post("/feedback-history")
@require_auth
def feedback_history_add():
    body = request.get_json(silent=True) or {}

    doc_id = _trim_text(body.get("docId"), MAX_DOC_ID_CHARS)
    card_id = _trim_text(body.get("cardId"), MAX_CARD_ID_CHARS)
    issue = _trim_text(body.get("issue"))
    why = _trim_text(body.get("why"))

    if not doc_id:
        return jsonify(ok=False, error="missing_doc_id"), 400
    if not card_id:
        return jsonify(ok=False, error="missing_card_id"), 400
    if not issue and not why:
        return jsonify(ok=False, error="missing_feedback_fields"), 400
    decision = _trim_text(body.get("decision"), 24).lower()
    if decision not in VALID_DECISIONS:
        return jsonify(ok=False, error="invalid_decision"), 400

    fix_options_raw = body.get("fixOptions")
    if fix_options_raw is not None and not isinstance(fix_options_raw, list):
        return jsonify(ok=False, error="invalid_fix_options"), 400

    now = datetime.now(timezone.utc).isoformat()
    # Canonical record per (user, doc, card): latest decision overwrites previous.
    record_id = f"{g.user_id}_{doc_id}_{card_id}"
    created_at = now
    try:
        existing = get_db().collection(COLLECTION).document(record_id).get()
        if existing.exists:
            existing_data = existing.to_dict() or {}
            created_at = str(existing_data.get("createdAt") or now)
    except Exception:
        created_at = now
    record: dict = {
        "id": record_id,
        "userId": g.user_id,
        "docId": doc_id,
        "cardId": card_id,
        "decision": decision,
        "createdAt": created_at,
        "updatedAt": now,
    }

    if issue:
        record["issue"] = issue
    if why:
        record["why"] = why
    if body.get("category") is not None:
        record["category"] = _trim_text(body.get("category"), 120)

    if isinstance(fix_options_raw, list):
        record["fixOptions"] = [
            _trim_text(item) for item in fix_options_raw if _trim_text(item)
        ][:MAX_FIX_OPTIONS]

    try:
        get_db().collection(COLLECTION).document(record_id).set(record, merge=True)
        return jsonify(ok=True, id=record_id), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500


@bp.get("/feedback-history")
@require_auth
def feedback_history_list():
    doc_id = _trim_text(request.args.get("docId"), MAX_DOC_ID_CHARS)
    decision = _trim_text(request.args.get("decision"), 24).lower()
    if decision and decision not in VALID_DECISIONS:
        return jsonify(ok=False, error="invalid_decision"), 400
    try:
        query = get_db().collection(COLLECTION).where("userId", "==", g.user_id)
        if doc_id:
            query = query.where("docId", "==", doc_id)
        if decision:
            query = query.where("decision", "==", decision)

        items: list[dict] = []
        for snap in query.stream():
            data = snap.to_dict() or {}
            items.append({"id": data.get("id") or snap.id, **data})
        items = _latest_rows(items)
        items.sort(key=lambda row: str(row.get("updatedAt") or row.get("createdAt") or ""), reverse=True)
        return jsonify(items=items), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500


@bp.get("/feedback-history/stats")
@require_auth
def feedback_history_stats():
    try:
        all_rows_query = get_db().collection(COLLECTION).where("userId", "==", g.user_id)
        all_rows: list[dict] = []
        for snap in all_rows_query.stream():
            data = snap.to_dict() or {}
            all_rows.append({"id": data.get("id") or snap.id, **data})
        latest_rows = _latest_rows(all_rows)
        accepted_count = sum(1 for row in latest_rows if row.get("decision") == "accepted")

        user_snap = get_db().collection(USERS_COLLECTION).document(g.user_id).get()
        user_data = user_snap.to_dict() or {} if user_snap.exists else {}
        return jsonify(acceptedCount=accepted_count, lastCoachedAt=user_data.get(LAST_COACHED_FIELD)), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500


@bp.post("/feedback-history/coach-session")
@require_auth
def feedback_history_mark_coach_session():
    now = datetime.now(timezone.utc).isoformat()
    try:
        get_db().collection(USERS_COLLECTION).document(g.user_id).set(
            {"userId": g.user_id, LAST_COACHED_FIELD: now, "updatedAt": now},
            merge=True,
        )
        return jsonify(ok=True, lastCoachedAt=now), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
