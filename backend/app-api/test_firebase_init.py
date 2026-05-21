"""Tests for Firebase credential env resolution (no network / no real keys)."""

import json
from pathlib import Path

import pytest

from firebase.init import firebase_credentials_status, load_firebase_credential_env


@pytest.fixture(autouse=True)
def _clear_firebase_env(monkeypatch):
    for key in list(__import__("os").environ):
        if key.startswith("FIREBASE_"):
            monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("APP_ENV", "dev")


def test_missing_credentials_reports_hint(monkeypatch):
    st = firebase_credentials_status()
    assert st["configured"] is False
    assert "FIREBASE_SERVICE_ACCOUNT_JSON_DEV" in st["hint"]


def test_json_env_marks_configured(monkeypatch):
    payload = {"type": "service_account", "project_id": "demo"}
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", json.dumps(payload))
    st = firebase_credentials_status()
    assert st["configured"] is True
    assert st["source"] == "FIREBASE_SERVICE_ACCOUNT_JSON"


def test_credentials_path_resolves_under_repo(tmp_path, monkeypatch):
    key_file = tmp_path / "sa.json"
    key_file.write_text(json.dumps({"type": "service_account"}), encoding="utf-8")
    monkeypatch.setenv("FIREBASE_CREDENTIALS_PATH", str(key_file))
    st = firebase_credentials_status()
    assert st["configured"] is True


def test_prod_suffix_wins_over_unsuffixed(monkeypatch):
    monkeypatch.setenv("APP_ENV", "prod")
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", json.dumps({"project_id": "dev"}))
    monkeypatch.setenv(
        "FIREBASE_SERVICE_ACCOUNT_JSON_PROD",
        json.dumps({"type": "service_account", "project_id": "prod"}),
    )
    raw, _ = load_firebase_credential_env()
    assert json.loads(raw)["project_id"] == "prod"
    st = firebase_credentials_status()
    assert st["source"] == "FIREBASE_SERVICE_ACCOUNT_JSON_PROD"
