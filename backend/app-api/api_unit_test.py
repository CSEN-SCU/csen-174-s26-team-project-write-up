"""Unit tests for services with mocked Firestore (no live credentials)."""

from unittest.mock import MagicMock, patch

from services import (
    get_user_preferences,
    get_user_profile,
    update_user_preferences,
    verify_google_token,
)


def _firestore_mock(users_store=None, prefs_store=None):
    """Dual-collection mock: users and preferences docs keyed by uid."""
    users_store = dict(users_store or {})
    prefs_store = dict(prefs_store or {})

    db = MagicMock()

    def collection(name):
        store = users_store if name == "users" else prefs_store
        col = MagicMock()

        def document(uid):
            ref = MagicMock()

            def _snap():
                snap = MagicMock()
                if uid in store:
                    snap.exists = True
                    snap.to_dict.return_value = dict(store[uid])
                else:
                    snap.exists = False
                    snap.to_dict.return_value = {}
                return snap

            ref.get.return_value = _snap()

            def _set(data, merge=False):
                if merge:
                    store[uid] = {**store.get(uid, {}), **dict(data)}
                else:
                    store[uid] = dict(data)

            ref.set.side_effect = _set
            return ref

        col.document.side_effect = document
        return col

    db.collection.side_effect = collection
    return db


def test_get_user_profile():
    # As a student, I see my profile email so I know which account I am signed in with.
    db = _firestore_mock(
        users_store={
            "test-user": {
                "userId": "test-user",
                "email": "test@example.com",
                "displayName": "Test",
            },
        },
    )
    with patch("services.get_db", return_value=db):
        result = get_user_profile("test-user")
    assert result["email"] == "test@example.com"


def test_get_user_preferences():
    # As a student, I see my saved focus areas so coaching matches how I want to improve.
    db = _firestore_mock()
    with patch("services.get_db", return_value=db):
        result = get_user_preferences("test-user")
    assert "focusAreas" in result
    assert result["tonePreference"] == "neutral"


def test_update_user_preferences():
    # As a student, I save my tone and focus preferences so future feedback stays aligned with my goals.
    db = _firestore_mock()
    with patch("services.get_db", return_value=db):
        result = update_user_preferences(
            "test-user",
            {"focusAreas": [], "tonePreference": "neutral"},
        )
    assert result is True


def test_verify_google_token():
    # As a student, I sign in with Google so the app recognizes me without managing another password.
    decoded = {
        "uid": "test-user",
        "email": "test@example.com",
        "name": "Test User",
    }
    with patch("services.ensure_firebase_app"), patch(
        "firebase_admin.auth.verify_id_token",
        return_value=decoded,
    ):
        result = verify_google_token("fake-token")
    assert result["uid"] == "test-user"
    assert result["email"] == "test@example.com"
