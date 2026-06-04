"""Tests for feedback-history delete (mocked Firestore)."""

from unittest.mock import MagicMock, patch

import pytest

from app import app

COLLECTION = "feedback_history"


@pytest.fixture(autouse=True)
def _auth_bypass_off(monkeypatch):
    monkeypatch.setenv("APP_AUTH_BYPASS", "0")


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _feedback_firestore_mock(store=None):
    store = dict(store or {})

    db = MagicMock()

    def collection(name):
        assert name == COLLECTION
        col = MagicMock()

        def document(record_id):
            ref = MagicMock()

            def _snap():
                snap = MagicMock()
                if record_id in store:
                    snap.exists = True
                    snap.to_dict.return_value = dict(store[record_id])
                else:
                    snap.exists = False
                    snap.to_dict.return_value = {}
                return snap

            ref.get.side_effect = _snap

            def _delete():
                store.pop(record_id, None)

            ref.delete.side_effect = _delete
            return ref

        col.document.side_effect = document
        return col

    db.collection.side_effect = collection
    return db, store


@patch("routes.feedback_history.get_db")
def test_delete_feedback_record(mock_get_db, client):
    record_id = "user-a_doc-1_card-1"
    db, store = _feedback_firestore_mock(
        {
            record_id: {
                "id": record_id,
                "userId": "user-a",
                "docId": "doc-1",
                "cardId": "card-1",
                "decision": "accepted",
            },
        },
    )
    mock_get_db.return_value = db

    with patch("auth.ensure_firebase_app"), patch(
        "auth.firebase_auth.verify_id_token",
        return_value={"uid": "user-a", "email": None, "name": None},
    ):
        res = client.delete(
            f"/api/feedback-history/{record_id}",
            headers={"Authorization": "Bearer fake"},
        )
        assert res.status_code == 200
        assert res.get_json()["ok"] is True
        assert record_id not in store


@patch("routes.feedback_history.get_db")
def test_delete_feedback_record_not_owned(mock_get_db, client):
    record_id = "user-b_doc-1_card-1"
    db, store = _feedback_firestore_mock(
        {
            record_id: {
                "id": record_id,
                "userId": "user-b",
                "docId": "doc-1",
                "cardId": "card-1",
                "decision": "accepted",
            },
        },
    )
    mock_get_db.return_value = db

    with patch("auth.ensure_firebase_app"), patch(
        "auth.firebase_auth.verify_id_token",
        return_value={"uid": "user-a", "email": None, "name": None},
    ):
        res = client.delete(
            f"/api/feedback-history/{record_id}",
            headers={"Authorization": "Bearer fake"},
        )
        assert res.status_code == 404
        assert record_id in store
