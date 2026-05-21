"""Local JSON store used when APP_LOCAL_DEV_STORE=1."""

import json
from pathlib import Path

import pytest

from app import app
import local_store


@pytest.fixture(autouse=True)
def _local_store_env(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_LOCAL_DEV_STORE", "1")
    monkeypatch.setenv("APP_AUTH_BYPASS", "1")
    monkeypatch.setenv("APP_ENV", "dev")
    store = tmp_path / "store.json"
    monkeypatch.setattr(local_store, "_STORE_PATH", store)


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_local_documents_crud(client):
    headers = {"X-Debug-User": "local-tester"}
    create = client.post("/documents", json={"title": "Essay"}, headers=headers)
    assert create.status_code == 201
    doc_id = create.get_json()["id"]

    listing = client.get("/documents", headers=headers)
    assert listing.status_code == 200
    assert len(listing.get_json()["documents"]) == 1

    updated = client.put(
        f"/documents/{doc_id}",
        json={"content": "Hello world with enough text for coaching tests."},
        headers=headers,
    )
    assert updated.status_code == 200
    assert "Hello world" in updated.get_json()["content"]
