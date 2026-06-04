"""Per-user writing documents stored in Firestore."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from firebase.init import get_db

bp = Blueprint("documents", __name__)

COLLECTION = "documents"
MAX_CONTENT_CHARS = 200_000
MAX_TITLE_CHARS = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_ref(doc_id: str):
    return get_db().collection(COLLECTION).document(doc_id)


def _owned_doc(doc_id: str):
    """Return the document dict if it exists and belongs to the current user, else None."""
    snap = _doc_ref(doc_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if data.get("userId") != g.user_id:
        return None
    return data


@bp.get("/documents")
@require_auth
def list_documents():
    try:
        db = get_db()
        items = []
        for snap in db.collection(COLLECTION).where("userId", "==", g.user_id).stream():
            data = snap.to_dict() or {}
            items.append({
                "id": data.get("id") or snap.id,
                "title": data.get("title") or "Untitled",
                "updatedAt": data.get("updatedAt") or data.get("createdAt") or "",
            })
        items.sort(key=lambda d: str(d.get("updatedAt") or ""), reverse=True)
        return jsonify(documents=items), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500


@bp.post("/documents")
@require_auth
def create_document():
    body = request.get_json(silent=True) or {}
    title_raw = body.get("title")
    title = title_raw.strip()[:MAX_TITLE_CHARS] if isinstance(title_raw, str) and title_raw.strip() else "Untitled"

    doc_id = str(uuid.uuid4())
    now = _now_iso()
    record = {
        "id": doc_id,
        "userId": g.user_id,
        "title": title,
        "content": "",
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        _doc_ref(doc_id).set(record)
        return jsonify(record), 201
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500


@bp.get("/documents/<doc_id>")
@require_auth
def get_document(doc_id: str):
    try:
        doc = _owned_doc(doc_id)
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
    if not doc:
        return jsonify(ok=False, error="not_found"), 404
    return jsonify(doc), 200


@bp.put("/documents/<doc_id>")
@require_auth
def update_document(doc_id: str):
    body = request.get_json(silent=True) or {}
    try:
        prev = _owned_doc(doc_id)
        if not prev:
            return jsonify(ok=False, error="not_found"), 404

        title = prev.get("title") or "Untitled"
        if isinstance(body.get("title"), str) and body["title"].strip():
            title = body["title"].strip()[:MAX_TITLE_CHARS]

        content = prev.get("content", "")
        if isinstance(body.get("content"), str):
            content = body["content"][:MAX_CONTENT_CHARS]

        next_doc = {**prev, "title": title, "content": content, "updatedAt": _now_iso()}
        _doc_ref(doc_id).set(next_doc, merge=True)
        return jsonify(next_doc), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500


def _delete_feedback_for_doc(doc_id: str) -> None:
    """Remove feedback-history rows tied to a document (best-effort)."""
    from routes.feedback_history import COLLECTION as FEEDBACK_COLLECTION

    db = get_db()
    query = (
        db.collection(FEEDBACK_COLLECTION)
        .where("userId", "==", g.user_id)
        .where("docId", "==", doc_id)
    )
    for snap in query.stream():
        snap.reference.delete()


@bp.delete("/documents/<doc_id>")
@require_auth
def delete_document(doc_id: str):
    try:
        if not _owned_doc(doc_id):
            return jsonify(ok=False, error="not_found"), 404
        _delete_feedback_for_doc(doc_id)
        _doc_ref(doc_id).delete()
        return jsonify(ok=True), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
