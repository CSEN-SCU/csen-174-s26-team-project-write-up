"""Per-user writing documents (Firestore). Powers the webapp editor like the Chris prototype."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from errors import safe_firestore
from firebase.init import get_db
from local_store import use_local_store
import local_store as local_docs

bp = Blueprint("documents", __name__)

COLLECTION = "documents"
MAX_CONTENT_CHARS = 200_000
MAX_TITLE_CHARS = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_ref(doc_id: str):
    return get_db().collection(COLLECTION).document(doc_id)


def _owned_doc(doc_id: str):
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
    if use_local_store():
        return jsonify(documents=local_docs.list_documents(g.user_id)), 200

    def _read():
        db = get_db()
        items = []
        for snap in db.collection(COLLECTION).where("userId", "==", g.user_id).stream():
            data = snap.to_dict() or {}
            items.append(
                {
                    "id": data.get("id") or snap.id,
                    "title": data.get("title") or "Untitled",
                    "updatedAt": data.get("updatedAt") or data.get("createdAt") or "",
                }
            )
        items.sort(key=lambda d: str(d.get("updatedAt") or ""), reverse=True)
        return items

    items, err = safe_firestore(_read, fallback=[])
    if err is not None:
        raise err
    return jsonify(documents=items), 200


@bp.post("/documents")
@require_auth
def create_document():
    body = request.get_json(silent=True) or {}
    if use_local_store():
        title_raw = body.get("title")
        title = "Untitled"
        if isinstance(title_raw, str) and title_raw.strip():
            title = title_raw.strip()[:MAX_TITLE_CHARS]
        return jsonify(local_docs.create_document(g.user_id, title)), 201

    title_raw = body.get("title")
    title = "Untitled"
    if isinstance(title_raw, str) and title_raw.strip():
        title = title_raw.strip()[:MAX_TITLE_CHARS]

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

    def _write():
        _doc_ref(doc_id).set(record)
        return record

    doc, err = safe_firestore(_write)
    if err is not None:
        raise err
    return jsonify(doc), 201


@bp.get("/documents/<doc_id>")
@require_auth
def get_document(doc_id: str):
    if use_local_store():
        doc = local_docs.get_document(g.user_id, doc_id)
        if not doc:
            return jsonify(ok=False, error="not_found"), 404
        return jsonify(doc), 200

    def _read():
        return _owned_doc(doc_id)

    doc, err = safe_firestore(_read)
    if err is not None:
        raise err
    if not doc:
        return jsonify(ok=False, error="not_found"), 404
    return jsonify(doc), 200


@bp.put("/documents/<doc_id>")
@require_auth
def update_document(doc_id: str):
    body = request.get_json(silent=True) or {}

    if use_local_store():
        prev = local_docs.get_document(g.user_id, doc_id)
        if not prev:
            return jsonify(ok=False, error="not_found"), 404
        title = prev.get("title") or "Untitled"
        if isinstance(body.get("title"), str):
            t = body["title"].strip()
            if t:
                title = t[:MAX_TITLE_CHARS]
        content = prev.get("content", "")
        if isinstance(body.get("content"), str):
            content = body["content"][:MAX_CONTENT_CHARS]
        doc = local_docs.update_document(
            g.user_id, doc_id, title=title, content=content,
        )
        return jsonify(doc), 200

    def _write():
        prev = _owned_doc(doc_id)
        if not prev:
            return None

        content = prev.get("content", "")
        if isinstance(body.get("content"), str):
            content = body["content"][:MAX_CONTENT_CHARS]

        title = prev.get("title") or "Untitled"
        if isinstance(body.get("title"), str):
            t = body["title"].strip()
            if t:
                title = t[:MAX_TITLE_CHARS]

        next_doc = {
            **prev,
            "title": title,
            "content": content,
            "updatedAt": _now_iso(),
        }
        _doc_ref(doc_id).set(next_doc, merge=True)
        return next_doc

    doc, err = safe_firestore(_write)
    if err is not None:
        raise err
    if not doc:
        return jsonify(ok=False, error="not_found"), 404
    return jsonify(doc), 200
