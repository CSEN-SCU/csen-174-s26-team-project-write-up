def get_user_profile(user_id: str) -> dict:
    """TODO: load from Firestore / auth; must satisfy api_unit_test."""
    return {"email": "wrong@example.com"}




def get_user_preferences(user_id: str) -> dict:
    """TODO: load preferences document."""
    return {}  # no focusAreas → test fails




def update_user_preferences(user_id: str, prefs: dict) -> bool:
    """TODO: persist preferences."""
    return False




def verify_google_token(token: str) -> dict:
    """TODO: verify with Firebase Admin / Google; return decoded user."""
    return {"uid": "not-test-user"}



