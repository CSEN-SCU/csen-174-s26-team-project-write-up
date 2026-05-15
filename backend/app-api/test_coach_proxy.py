"""Tests for authenticated coaching proxy (no live coaching-api)."""

import json
from unittest.mock import MagicMock, patch

import pytest

from app import app


@pytest.fixture(autouse=True)
def _coaching_internal_secret_env(monkeypatch):
    monkeypatch.setenv("COACHING_INTERNAL_SECRET", "test-coaching-internal")
    # Repo root .env often sets APP_AUTH_BYPASS=1 for local Chrome; these tests use Bearer + mocked verify.
    monkeypatch.setenv("APP_AUTH_BYPASS", "0")


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _mock_urlopen_response(body: bytes, status: int = 200):
    resp = MagicMock()
    resp.read.return_value = body
    resp.getcode.return_value = status
    ctx = MagicMock()
    ctx.__enter__.return_value = resp
    ctx.__exit__.return_value = False
    return ctx


@patch("routes.coach_proxy.urlopen")
def test_coach_proxy_overwrites_user_id_and_forwards_body(mock_urlopen, client):
    mock_urlopen.return_value = _mock_urlopen_response(
        json.dumps({"runId": "run-1", "userId": "trusted", "ok": True}).encode(),
    )

    with patch(
        "auth.verify_google_token",
        return_value={"uid": "trusted", "email": None, "name": None},
    ):
        res = client.post(
            "/coach",
            json={"text": "Hello world.", "userId": "evil-impersonator", "surface": "web"},
            headers={"Authorization": "Bearer fake"},
        )

    assert res.status_code == 200
    assert res.get_json()["runId"] == "run-1"

    forwarded = mock_urlopen.call_args[0][0]
    sent = {k.lower(): v for k, v in forwarded.header_items()}
    assert sent.get("x-coaching-internal-secret") == "test-coaching-internal"
    payload = json.loads(forwarded.data.decode("utf-8"))
    assert payload["userId"] == "trusted"
    assert payload["text"] == "Hello world."
    assert payload["surface"] == "web"


@patch("routes.coach_proxy.urlopen")
def test_dismiss_proxy_forces_user_id(mock_urlopen, client):
    mock_urlopen.return_value = _mock_urlopen_response(
        json.dumps({"ok": True, "profileSnapshot": {}}).encode(),
    )

    with patch(
        "auth.verify_google_token",
        return_value={"uid": "uid-42", "email": None, "name": None},
    ):
        res = client.post(
            "/dismiss",
            json={"title": "A suggestion", "userId": "someone-else"},
            headers={"Authorization": "Bearer fake"},
        )

    assert res.status_code == 200
    forwarded = mock_urlopen.call_args[0][0]
    sent = {k.lower(): v for k, v in forwarded.header_items()}
    assert sent.get("x-coaching-internal-secret") == "test-coaching-internal"
    payload = json.loads(forwarded.data.decode("utf-8"))
    assert payload["userId"] == "uid-42"
    assert payload["title"] == "A suggestion"
