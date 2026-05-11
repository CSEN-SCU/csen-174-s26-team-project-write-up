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
from errors import ApiError

log = logging.getLogger(__name__)

bp = Blueprint("coach_proxy", __name__)


def _coaching_base_url() -> str:
    return os.environ.get("COACHING_API_BASE_URL", "http://127.0.0.1:8787").strip().rstrip("/")


def _timeout_s() -> float:
    raw = os.environ.get("COACHING_HTTP_TIMEOUT_S", "120")
    try:
        return max(1.0, float(raw))
    except ValueError:
        return 120.0


def _forward_post(path: str, payload: dict[str, Any]) -> tuple[Any, int]:
    base = _coaching_base_url()
    url = f"{base}{path}"
    rid = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    body_bytes = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body_bytes,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Request-Id": rid,
        },
        method="POST",
    )
    timeout = _timeout_s()
    try:
        with urlopen(req, timeout=timeout) as resp:  # noqa: S310 - URL from env, not user input
            raw = resp.read().decode("utf-8")
            status = int(resp.getcode() or 200)
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        status = int(e.code or 502)
    except TimeoutError as e:
        log.warning("Coaching upstream timeout url=%s", url)
        raise ApiError("coaching_timeout", 504, "Coaching service timed out") from e
    except URLError as e:
        log.warning("Coaching upstream unreachable url=%s err=%s", url, e)
        raise ApiError("coaching_upstream", 502, "Coaching service unreachable") from e

    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        log.warning("Coaching non-JSON status=%s preview=%s", status, raw[:240])
        raise ApiError("coaching_bad_response", 502, "Invalid JSON from coaching service")

    return data, status


def _force_uid_payload() -> dict[str, Any]:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        body = {}
    client_uid = body.get("userId")
    if client_uid is not None and str(client_uid) != str(g.user_id):
        log.warning("Body userId does not match token uid (using token): client=%s", client_uid)
    out = dict(body)
    out["userId"] = g.user_id
    return out


@bp.post("/coach")
@require_auth
def proxy_coach():
    payload = _force_uid_payload()
    data, status = _forward_post("/coach", payload)
    return jsonify(data), status


@bp.post("/dismiss")
@require_auth
def proxy_dismiss():
    payload = _force_uid_payload()
    data, status = _forward_post("/dismiss", payload)
    return jsonify(data), status
