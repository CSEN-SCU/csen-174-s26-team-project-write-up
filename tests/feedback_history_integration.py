"""
Integration-style tests: Flask test_client + mocked Firestore via get_db.

Requires feedback_history routes to:
  - from firebase.init import get_db   (or equivalent; adjust patch path)
  - POST: get_db().collection("feedback_history").document(<id>).set(<dict>)
  - GET:  for doc in get_db().collection("feedback_history").stream(): doc.to_dict()

Until routes use get_db and return 200 + JSON, these tests will fail on status/body.
"""
import sys
from pathlib import Path

from unittest.mock import MagicMock, patch

import pytest

# Repo root / backend/app-api on path so `from app import app` works without PYTHONPATH.
_root = Path(__file__).resolve().parents[1]
_app_api = _root / "backend" / "app-api"
if str(_app_api) not in sys.path:
    sys.path.insert(0, str(_app_api))

from app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def firestore_rows():
    """In-memory stand-in for documents in the feedback_history collection."""
    return []


@pytest.fixture
def mock_get_db(firestore_rows):
    """Returns a callable that produces a fresh mock DB wired to firestore_rows."""

    def _factory():
        db = MagicMock()
        col = MagicMock()
        db.collection.return_value = col

        def iter_stream():
            for row in firestore_rows:
                doc = MagicMock()
                doc.to_dict.return_value = row
                yield doc

        col.stream.side_effect = iter_stream

        doc_ref = MagicMock()
        col.document.return_value = doc_ref

        def set_data(data, merge=False):
            firestore_rows.append(dict(data))

        doc_ref.set.side_effect = set_data

        return db

    return _factory


def test_post_then_get_feedback_history_round_trip(client, mock_get_db):
    """POST creates a row in mocked Firestore; GET returns it in `items`."""
    # As a writer, I save coaching feedback for a document and later open that document's history so I can see what was saved.
    # Arrange
    payload = {
        "userId": "user-1",
        "docId": "doc-1",
        "cardId": "card-1",
        "category": "grammar",
        "issue": "test issue",
    }

    with patch("routes.feedback_history.get_db", side_effect=mock_get_db):
        # Action
        post_res = client.post("/feedback-history", json=payload)
        # Assert
        assert post_res.status_code == 200
        post_body = post_res.get_json()
        assert post_body.get("ok") is True
        # Not implemented yet: API should return a stable id for the created history row (for undo / deep links).
        assert isinstance(post_body.get("historyId"), str) and len(post_body["historyId"]) > 0

        # Action
        get_res = client.get("/feedback-history?docId=doc-1")
        # Assert
        assert get_res.status_code == 200
        body = get_res.get_json()
        assert "items" in body
        assert isinstance(body["items"], list)
        assert len(body["items"]) >= 1
        # Not implemented yet: list responses should advertise a contract version for clients.
        assert body.get("schemaVersion") == 1
        # Adjust key names to match your real Firestore document shape
        stored = body["items"][0]
        assert stored.get("userId") == "user-1"
        assert stored.get("docId") == "doc-1"
        # Not implemented yet: every stored card should include a model confidence score for the dashboard.
        assert isinstance(stored.get("confidence"), (int, float))
        assert 0 <= float(stored["confidence"]) <= 1


def test_get_feedback_history_empty_collection(client, mock_get_db, firestore_rows):
    # As a writer, I open my feedback history before saving anything so I see an empty list instead of an error.
    # Arrange
    firestore_rows.clear()
    with patch("routes.feedback_history.get_db", side_effect=mock_get_db):
        # Action
        get_res = client.get("/feedback-history")
        # Assert
        assert get_res.status_code == 200
        body = get_res.get_json()
        assert body.get("items") == []
        # Not implemented yet: empty history should still report totalCount for the UI.
        assert body.get("totalCount") == 0