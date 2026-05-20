"""Tests for auth.require_auth without running Firebase or Firestore."""

from unittest.mock import patch

import pytest
from flask import Flask, g, jsonify

from auth import require_auth
from errors import ApiError


@pytest.fixture
def probe_app():
    app = Flask(__name__)

    @app.errorhandler(ApiError)
    def _handle_api_error(err):
        return jsonify(ok=False, error=err.code, message=err.message), err.status

    @app.get("/probe")
    @require_auth
    def probe():
        return jsonify(uid=g.user_id, email=g.user_email, name=g.user_name)

    app.config["TESTING"] = True
    return app


@pytest.fixture
def client(probe_app):
    with probe_app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def _disable_dev_auth_bypass_for_probe(monkeypatch):
    """Repo .env often sets APP_AUTH_BYPASS=1; these tests assert Bearer / missing_token behavior."""
    monkeypatch.setenv("APP_AUTH_BYPASS", "0")


def test_missing_authorization_returns_401(client):
    res = client.get("/probe")
    assert res.status_code == 401
    body = res.get_json()
    assert body["ok"] is False
    assert body["error"] == "missing_token"


def test_empty_bearer_token_returns_401(client):
    res = client.get("/probe", headers={"Authorization": "Bearer "})
    assert res.status_code == 401
    assert res.get_json()["error"] == "missing_token"


def test_verify_raises_api_error_propagates(client):
    with patch(
        "auth.verify_google_token",
        side_effect=ApiError("unauthenticated", 401, "bad"),
    ):
        res = client.get("/probe", headers={"Authorization": "Bearer x"})
    assert res.status_code == 401
    assert res.get_json()["error"] == "unauthenticated"


def test_verify_failure_wrapped_as_unauthenticated(client):
    with patch("auth.verify_google_token", side_effect=RuntimeError("network")):
        res = client.get("/probe", headers={"Authorization": "Bearer x"})
    assert res.status_code == 401
    assert res.get_json()["error"] == "unauthenticated"


def test_good_bearer_token_sets_identity(client):
    with patch(
        "auth.verify_google_token",
        return_value={
            "uid": "u1",
            "email": "u1@example.com",
            "name": "User One",
        },
    ):
        res = client.get("/probe", headers={"Authorization": "Bearer valid.jwt"})
    assert res.status_code == 200
    body = res.get_json()
    assert body["uid"] == "u1"
    assert body["email"] == "u1@example.com"
    assert body["name"] == "User One"


def test_auth_bypass_with_x_debug_user(client, monkeypatch):
    monkeypatch.setenv("APP_AUTH_BYPASS", "1")
    monkeypatch.setenv("APP_ENV", "test")
    res = client.get(
        "/probe",
        headers={
            "X-Debug-User": "alice",
            "X-Debug-Email": "alice@example.com",
            "X-Debug-Name": "Alice",
        },
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["uid"] == "alice"
    assert body["email"] == "alice@example.com"
    assert body["name"] == "Alice"


def test_auth_bypass_still_accepts_bearer_token(client, monkeypatch):
    """Dev bypass must not block signed-in webapp users (Firebase Bearer)."""
    monkeypatch.setenv("APP_AUTH_BYPASS", "1")
    monkeypatch.setenv("APP_ENV", "test")
    with patch(
        "auth.verify_google_token",
        return_value={
            "uid": "firebase-uid",
            "email": "u@example.com",
            "name": "Web User",
        },
    ):
        res = client.get("/probe", headers={"Authorization": "Bearer valid.jwt"})
    assert res.status_code == 200
    assert res.get_json()["uid"] == "firebase-uid"
