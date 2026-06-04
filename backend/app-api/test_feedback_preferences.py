"""Tests for feedback preference summary used by coach proxy."""

from unittest.mock import MagicMock, patch

from routes.feedback_history import build_feedback_preferences

COLLECTION = "feedback_history"


def _feedback_store_mock(store=None):
    store = dict(store or {})

    db = MagicMock()

    def collection(name):
        assert name == COLLECTION
        col = MagicMock()

        def _where(field, op, value):
            q = MagicMock()

            def _stream():
                for record_id, data in store.items():
                    if data.get(field) == value:
                        snap = MagicMock()
                        snap.id = record_id
                        snap.to_dict.return_value = dict(data)
                        yield snap

            q.stream.side_effect = _stream
            return q

        col.where.side_effect = _where
        return col

    db.collection.side_effect = collection
    return db


@patch("routes.feedback_history.get_db")
def test_build_feedback_preferences_summarizes_decisions(mock_get_db):
    store = {
        "u1_d1_c1": {
            "userId": "u1",
            "docId": "d1",
            "cardId": "c1",
            "decision": "declined",
            "category": "spelling",
            "issue": 'Spelling: "teh"',
            "updatedAt": "2026-06-01T00:00:00Z",
        },
        "u1_d1_c2": {
            "userId": "u1",
            "docId": "d1",
            "cardId": "c2",
            "decision": "accepted",
            "category": "grammar",
            "issue": 'Grammar: "your welcome"',
            "updatedAt": "2026-06-02T00:00:00Z",
        },
    }
    mock_get_db.return_value = _feedback_store_mock(store)

    prefs = build_feedback_preferences("u1")
    assert len(prefs["declined"]) == 1
    assert len(prefs["accepted"]) == 1
    assert prefs["categoryScores"]["spelling"]["declined"] == 1
    assert prefs["categoryScores"]["grammar"]["accepted"] == 1
