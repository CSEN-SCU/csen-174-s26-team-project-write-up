from services import (
    get_user_profile,
    get_user_preferences,
    update_user_preferences,
    verify_google_token,
)




def test_get_user_profile():
    # As a student, I see my profile email so I know which account I am signed in with.
    # Arrange
    # Action
    result = get_user_profile("test-user")
    # Assert
    assert result["email"] == "test@example.com"




def test_get_user_preferences():
    # As a student, I see my saved focus areas so coaching matches how I want to improve.
    # Arrange
    # Action
    result = get_user_preferences("test-user")
    # Assert
    assert "focusAreas" in result




def test_update_user_preferences():
    # As a student, I save my tone and focus preferences so future feedback stays aligned with my goals.
    # Arrange
    # Action
    result = update_user_preferences(
        "test-user",
        {"focusAreas": [], "tonePreference": "neutral"},
    )
    # Assert
    assert result is True




def test_verify_google_token():
    # As a student, I sign in with Google so the app recognizes me without managing another password.
    # Arrange
    # Action
    result = verify_google_token("fake-token")
    # Assert
    assert result["uid"] == "test-user"

