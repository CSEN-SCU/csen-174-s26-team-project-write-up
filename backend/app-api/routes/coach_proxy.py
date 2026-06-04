"""Authenticated proxy to coaching-api (Node). Forces userId from the verified token."""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from routes.feedback_history import build_feedback_preferences

log = logging.getLogger(__name__)

bp = Blueprint("coach_proxy", __name__)

_COACHING_INTERNAL_HEADER = "X-Coaching-Internal-Secret"


def _coaching_base_url() -> str:
    return os.environ.get("COACHING_API_BASE_URL", "http://127.0.0.1:8787").strip().rstrip("/")


def _timeout_s() -> float:
    try:
        return max(1.0, float(os.environ.get("COACHING_HTTP_TIMEOUT_S", "120")))
    except ValueError:
        return 120.0


def _forward_post(path: str, payload: dict[str, Any]) -> tuple[Any, int]:
    secret = os.environ.get("COACHING_INTERNAL_SECRET", "").strip()
    if not secret:
        return {"ok": False, "error": "server_misconfigured"}, 503

    base = _coaching_base_url()
    url = f"{base}{path}"
    rid = (request.headers.get("X-Request-Id") or "").strip() or str(uuid.uuid4())
    body_bytes = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body_bytes,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Request-Id": rid,
            _COACHING_INTERNAL_HEADER: secret,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=_timeout_s()) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8")
            status = int(resp.getcode() or 200)
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        status = int(e.code or 502)
        log.warning("Coaching upstream HTTP %s url=%s rid=%s", status, url, rid)
    except TimeoutError:
        log.warning("Coaching upstream timeout url=%s rid=%s", url, rid)
        return {"ok": False, "error": "coaching_timeout"}, 504
    except URLError:
        log.warning("Coaching upstream unreachable url=%s rid=%s", url, rid)
        return {"ok": False, "error": "coaching_upstream"}, 502

    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        log.warning("Coaching non-JSON status=%s rid=%s preview=%s", status, rid, raw[:240])
        return {"ok": False, "error": "coaching_bad_response"}, 502

    return data, status


def _force_uid_payload() -> dict[str, Any]:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        body = {}
    out = dict(body)
    out["userId"] = g.user_id
    out["feedbackPreferences"] = build_feedback_preferences(g.user_id)
    return out


@bp.post("/coach")
@require_auth
def proxy_coach():
    data, status = _forward_post("/coach", _force_uid_payload())
    return jsonify(data), status


@bp.post("/dismiss")
@require_auth
def proxy_dismiss():
    data, status = _forward_post("/dismiss", _force_uid_payload())
    return jsonify(data), status
