from services import (
    get_user_profile,
    get_user_preferences,
    update_user_preferences,
    verify_google_token,
)




def test_get_user_profile():
    result = get_user_profile("test-user")


    assert result["email"] == "test@example.com"




def test_get_user_preferences():
    result = get_user_preferences("test-user")


    assert "focusAreas" in result




def test_update_user_preferences():
    result = update_user_preferences(
        "test-user",
        {"focusAreas": [], "tonePreference": "neutral"},
    )


    assert result is True




def test_verify_google_token():
    result = verify_google_token("fake-token")


    assert result["uid"] == "test-user"

