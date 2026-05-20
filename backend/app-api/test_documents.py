"""Tests for per-user document routes (mocked Firestore)."""

import json
from unittest.mock import MagicMock, patch

import pytest

from app import app

COLLECTION = "documents"


@pytest.fixture(autouse=True)
def _auth_bypass_off(monkeypatch):
    monkeypatch.setenv("APP_AUTH_BYPASS", "0")


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _documents_firestore_mock(store=None):
    """In-memory documents collection keyed by doc id."""
    store = dict(store or {})

    db = MagicMock()

    def collection(name):
        assert name == COLLECTION
        col = MagicMock()

        def document(doc_id):
            ref = MagicMock()

            def _snap():
                snap = MagicMock()
                if doc_id in store:
                    snap.exists = True
                    snap.to_dict.return_value = dict(store[doc_id])
                    snap.id = doc_id
                else:
                    snap.exists = False
                    snap.to_dict.return_value = {}
                return snap

            ref.get.side_effect = _snap

            def _set(data, merge=False):
                if merge and doc_id in store:
                    store[doc_id] = {**store[doc_id], **dict(data)}
                else:
                    store[doc_id] = dict(data)

            ref.set.side_effect = _set
            return ref

        col.document.side_effect = document

        def _where(field, op, value):
            q = MagicMock()

            def _stream():
                for doc_id, data in store.items():
                    if data.get(field) == value:
                        snap = MagicMock()
                        snap.id = doc_id
                        snap.to_dict.return_value = dict(data)
                        yield snap

            q.stream.side_effect = _stream
            return q

        col.where.side_effect = _where
        return col

    db.collection.side_effect = collection
    return db, store


@patch("routes.documents.get_db")
def test_create_and_list_documents(mock_get_db, client):
    db, store = _documents_firestore_mock()
    mock_get_db.return_value = db

    with patch(
        "auth.verify_google_token",
        return_value={"uid": "user-a", "email": None, "name": None},
    ):
        create = client.post(
            "/documents",
            json={"title": "My draft"},
            headers={"Authorization": "Bearer fake"},
        )
        assert create.status_code == 201
        body = create.get_json()
        assert body["title"] == "My draft"
        assert body["userId"] == "user-a"
        doc_id = body["id"]

        listed = client.get(
            "/documents",
            headers={"Authorization": "Bearer fake"},
        )
        assert listed.status_code == 200
        docs = listed.get_json()["documents"]
        assert len(docs) == 1
        assert docs[0]["id"] == doc_id


def _mock_urlopen_response(body: bytes, status: int = 200):
    resp = MagicMock()
    resp.read.return_value = body
    resp.getcode.return_value = status
    ctx = MagicMock()
    ctx.__enter__.return_value = resp
    ctx.__exit__.return_value = False
    return ctx


@patch("routes.coach_proxy.urlopen")
def test_coach_proxy_forwards_coach_mode(mock_urlopen, client, monkeypatch):
    monkeypatch.setenv("COACHING_INTERNAL_SECRET", "test-coaching-internal")
    mock_urlopen.return_value = _mock_urlopen_response(
        json.dumps({"suggestions": [], "profileSnapshot": {}}).encode(),
    )
    with patch(
        "auth.verify_google_token",
        return_value={"uid": "user-a", "email": None, "name": None},
    ):
        res = client.post(
            "/coach",
            json={"text": "Hello there world test.", "coachMode": "typing", "surface": "web"},
            headers={"Authorization": "Bearer fake"},
        )
    assert res.status_code == 200
    payload = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
    assert payload["coachMode"] == "typing"
    assert payload["userId"] == "user-a"
