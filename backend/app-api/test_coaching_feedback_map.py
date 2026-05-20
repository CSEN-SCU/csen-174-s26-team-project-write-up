"""Unit tests for swe-test ↔ coaching-api payload mapping."""

from routes.coaching_feedback_map import (
    body_to_coach_payload,
    coach_response_to_feedback,
)


def test_body_to_coach_payload_maps_draft_and_profile():
    payload = body_to_coach_payload(
        {
            "draft": "Hello world this is a test draft for coaching.",
            "role": "Student",
            "goal": "Clearer essays",
            "tone": "Friendly",
            "coachMode": "typing",
        },
        "uid-1",
    )
    assert payload["text"].startswith("Hello world")
    assert payload["userId"] == "uid-1"
    assert payload["audience"] == "Student"
    assert payload["goals"] == "Clearer essays"
    assert payload["tonePreference"] == "casual"
    assert payload["coachMode"] == "typing"
    assert payload["surface"] == "web"


def test_coach_response_to_feedback_adds_swe_test_shape():
    upstream = {
        "suggestions": [
            {
                "type": "clarity",
                "title": "Long sentence",
                "body": "Split this idea.",
                "micro_edit": "Use two shorter sentences.",
            }
        ],
        "retrievedChunks": [],
        "profileSnapshot": {"requests": 1},
    }
    out = coach_response_to_feedback(
        upstream,
        draft=(
            "Hello world this is a test draft for coaching with enough length here "
            "to reach the middle school band in the level heuristic."
        ),
    )
    assert out["issues"][0]["label"] == "Long sentence"
    assert out["practicePrompts"]
    assert out["summary"]
    assert out["level"] == "Middle school"
    assert out["suggestions"] == upstream["suggestions"]
    assert out["profileSnapshot"]["requests"] == 1
