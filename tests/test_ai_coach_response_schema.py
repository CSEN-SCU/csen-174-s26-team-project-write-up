"""
Contract tests for AI coaching responses (mocked LLM).

As a student, I want the coaching API to return structured JSON I can trust
(typed categories, bounded size) without brittle tests on exact wording.
"""
import json
from unittest.mock import patch

# --- Stand-in for your app's LLM HTTP layer (patch in tests; never hit the network here.) ---


def fetch_coach_llm(user_text: str) -> str:
    """Call the real LLM / coaching endpoint and return the raw response body (JSON string)."""
    raise RuntimeError("fetch_coach_llm must be patched in tests")


ALLOWED_CATEGORIES = frozenset({"grammar", "style", "clarity", "tone", "structure", "wording"})
REQUIRED_TOP_KEYS = frozenset({"recommendations", "meta"})
REQUIRED_REC_KEYS = frozenset({"category", "issue", "recommendation"})
REQUIRED_META_KEYS = frozenset({"estimated_output_tokens", "schema_version", "provider"})
ALLOWED_PROVIDERS = frozenset({"groq", "openai"})
EXPECTED_SCHEMA_VERSION = 1
MAX_ESTIMATED_OUTPUT_TOKENS = 2048
MAX_RECOMMENDATIONS = 20
# Rough size guard so responses stay bounded (proxy for "under N tokens" without a tokenizer).
MAX_RESPONSE_CHAR_LENGTH = 12_000


def build_coach_result(user_text: str) -> dict:
    """Parse LLM JSON and return a dict (your app would validate / transform here)."""
    raw = fetch_coach_llm(user_text)
    return json.loads(raw)


def assert_coach_contract(data: dict) -> None:
    """Schema + category + size checks only (no exact natural-language equality)."""
    assert isinstance(data, dict), "coach payload must be a JSON object"
    assert REQUIRED_TOP_KEYS.issubset(data.keys()), (
        f"missing top-level keys: {REQUIRED_TOP_KEYS - set(data.keys())}"
    )

    recs = data["recommendations"]
    assert isinstance(recs, list), "recommendations must be a list"
    assert len(recs) <= MAX_RECOMMENDATIONS, "too many recommendation cards"
    assert len(recs) >= 1, "expected at least one recommendation"

    for i, item in enumerate(recs):
        assert isinstance(item, dict), f"recommendations[{i}] must be an object"
        assert REQUIRED_REC_KEYS.issubset(item.keys()), (
            f"recommendations[{i}] missing keys: {REQUIRED_REC_KEYS - set(item.keys())}"
        )
        cat = item["category"]
        assert cat in ALLOWED_CATEGORIES, f"invalid category {cat!r}"
        tip = item["recommendation"]
        assert isinstance(tip, str) and len(tip.strip()) > 0, (
            "recommendation must be a non-empty string (content not matched exactly)"
        )

    meta = data["meta"]
    assert isinstance(meta, dict), "meta must be an object"
    assert REQUIRED_META_KEYS.issubset(meta.keys()), (
        f"meta missing keys: {REQUIRED_META_KEYS - set(meta.keys())}"
    )
    est = meta["estimated_output_tokens"]
    assert isinstance(est, int), "estimated_output_tokens must be int"
    assert 0 < est <= MAX_ESTIMATED_OUTPUT_TOKENS, "token estimate out of allowed range"
    assert meta.get("schema_version") == EXPECTED_SCHEMA_VERSION, (
        "meta.schema_version must match the supported coach JSON contract"
    )
    prov = meta.get("provider")
    assert prov in ALLOWED_PROVIDERS, "meta.provider must name a supported LLM backend"


def test_mocked_llm_returns_json_matching_coach_schema():
    # As a student, I get back structured coaching (categories + tips) within size limits so the UI can render it safely.
    # Arrange
    fake_llm_body = json.dumps(
        {
            "recommendations": [
                {
                    "category": "grammar",
                    "issue": "verb tense",
                    "recommendation": "Consider aligning past and present tense in this paragraph.",
                },
                {
                    "category": "clarity",
                    "issue": "long sentence",
                    "recommendation": "Split long sentences so each carries one main idea.",
                },
            ],
            # Intentionally omit schema_version + provider until the real coach layer adds them.
            "meta": {"estimated_output_tokens": 120},
        }
    )

    # Action
    with patch("test_ai_coach_response_schema.fetch_coach_llm", return_value=fake_llm_body):
        result = build_coach_result("Draft paragraph about my summer project.")

    # Assert (schema / categories / bounds only - not exact wording)
    assert_coach_contract(result)
    raw_len = len(fake_llm_body)
    assert raw_len <= MAX_RESPONSE_CHAR_LENGTH, "mocked response exceeds char budget (proxy for token cap)"
