"""JSON file store for local dev when Firestore is not configured (APP_LOCAL_DEV_STORE=1)."""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_APP_DIR = Path(__file__).resolve().parent
_STORE_PATH = _APP_DIR / ".local-data" / "store.json"
_LOCK = threading.Lock()


def use_local_store() -> bool:
    v = os.environ.get("APP_LOCAL_DEV_STORE", "").strip().lower()
    return v in ("1", "true", "yes", "y", "on")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict[str, Any]:
    if not _STORE_PATH.is_file():
        return {"users": {}}
    try:
        with _STORE_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("users"), dict):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {"users": {}}


def _save(data: dict[str, Any]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STORE_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(_STORE_PATH)


def _user_bucket(data: dict[str, Any], user_id: str) -> dict[str, Any]:
    users = data.setdefault("users", {})
    bucket = users.setdefault(user_id, {})
    bucket.setdefault("documents", {})
    bucket.setdefault("profile", {})
    return bucket


def list_documents(user_id: str) -> list[dict[str, Any]]:
    with _LOCK:
        data = _load()
        docs = _user_bucket(data, user_id).get("documents") or {}
        items = []
        for doc in docs.values():
            if isinstance(doc, dict):
                items.append(
                    {
                        "id": doc.get("id") or "",
                        "title": doc.get("title") or "Untitled",
                        "updatedAt": doc.get("updatedAt") or doc.get("createdAt") or "",
                    }
                )
        items.sort(key=lambda d: str(d.get("updatedAt") or ""), reverse=True)
        return items


def create_document(user_id: str, title: str) -> dict[str, Any]:
    doc_id = str(uuid.uuid4())
    now = _now_iso()
    record = {
        "id": doc_id,
        "userId": user_id,
        "title": title,
        "content": "",
        "createdAt": now,
        "updatedAt": now,
    }
    with _LOCK:
        data = _load()
        bucket = _user_bucket(data, user_id)
        bucket["documents"][doc_id] = record
        _save(data)
    return dict(record)


def get_document(user_id: str, doc_id: str) -> dict[str, Any] | None:
    with _LOCK:
        data = _load()
        doc = (_user_bucket(data, user_id).get("documents") or {}).get(doc_id)
        if not isinstance(doc, dict) or doc.get("userId") != user_id:
            return None
        return dict(doc)


def update_document(
    user_id: str,
    doc_id: str,
    *,
    title: str | None = None,
    content: str | None = None,
) -> dict[str, Any] | None:
    with _LOCK:
        data = _load()
        docs = _user_bucket(data, user_id).get("documents") or {}
        prev = docs.get(doc_id)
        if not isinstance(prev, dict) or prev.get("userId") != user_id:
            return None
        next_doc = dict(prev)
        if title is not None:
            next_doc["title"] = title
        if content is not None:
            next_doc["content"] = content
        next_doc["updatedAt"] = _now_iso()
        docs[doc_id] = next_doc
        _save(data)
        return dict(next_doc)


def upsert_user(
    user_id: str,
    *,
    email: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    with _LOCK:
        data = _load()
        bucket = _user_bucket(data, user_id)
        profile = bucket.setdefault("profile", {})
        now = _now_iso()
        if not profile:
            profile.update(
                {
                    "userId": user_id,
                    "email": email or "",
                    "displayName": display_name or "",
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
        else:
            profile["userId"] = user_id
            profile["updatedAt"] = now
            if email is not None:
                profile["email"] = email
            if display_name is not None:
                profile["displayName"] = display_name
        _save(data)
        return dict(profile)


def get_user_profile(user_id: str) -> dict[str, Any]:
    with _LOCK:
        data = _load()
        profile = (_user_bucket(data, user_id).get("profile") or {})
        return dict(profile) if isinstance(profile, dict) else {}


def merge_onboarding(user_id: str, patch: dict[str, Any]) -> None:
    with _LOCK:
        data = _load()
        bucket = _user_bucket(data, user_id)
        profile = bucket.setdefault("profile", {"userId": user_id})
        profile.update(patch)
        profile["updatedAt"] = _now_iso()
        _save(data)
