"""Map swe-test-style /api/coaching-feedback bodies to coaching-api POST /coach and back."""

from __future__ import annotations

from typing import Any


def _tone_to_preference(tone: str) -> str:
    t = tone.strip().lower()
    if any(w in t for w in ("formal", "professional", "academic")):
        return "formal"
    if any(w in t for w in ("casual", "friendly", "conversational", "warm")):
        return "casual"
    return "neutral"


def body_to_coach_payload(body: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Build coaching-api /coach JSON from webapp /api/coaching-feedback body."""
    draft = body.get("draft")
    if draft is None and body.get("text") is not None:
        draft = body.get("text")
    text = str(draft or "").strip()

    role = str(body.get("role") or "").strip()
    goal = str(body.get("goal") or "").strip()
    tone = str(body.get("tone") or "").strip()

    coach_mode = body.get("coachMode")
    mode = "typing" if coach_mode == "typing" else "paused"

    focus: list[str] = []
    for key in ("visibleIssues", "dismissedIssues", "focus"):
        raw = body.get(key)
        if isinstance(raw, list):
            focus.extend(str(x).strip() for x in raw if str(x).strip())

    payload: dict[str, Any] = {
        "text": text,
        "userId": user_id,
        "surface": str(body.get("surface") or "web"),
        "coachMode": mode,
    }
    if role:
        payload["audience"] = role[:200]
    if goal:
        payload["goals"] = goal[:300]
    if tone:
        payload["tonePreference"] = _tone_to_preference(tone)
    if focus:
        payload["focus"] = focus[:12]

    return payload


def _draft_level(draft: str) -> str:
    n = len(draft.strip())
    if n < 80:
        return "Kindergarten"
    if n < 180:
        return "Middle school"
    return "High school"


def _suggestion_to_issue(s: dict[str, Any]) -> dict[str, str]:
    stype = str(s.get("type") or "").lower()
    priority = "High" if stype in ("grammar", "punctuation", "spelling") else "Medium"
    micro = s.get("micro_edit")
    fix = str(micro).strip() if micro is not None and str(micro).strip() else ""
    return {
        "label": str(s.get("title") or "Suggestion").strip() or "Suggestion",
        "feedback": str(s.get("body") or "").strip(),
        "fix": fix,
        "priority": priority,
    }


def coach_response_to_feedback(
    upstream: dict[str, Any],
    *,
    draft: str = "",
) -> dict[str, Any]:
    """Merge coaching-api /coach response with swe-test-shaped fields for the webapp."""
    suggestions = upstream.get("suggestions") or upstream.get("cards") or []
    if not isinstance(suggestions, list):
        suggestions = []

    issues = [_suggestion_to_issue(s) for s in suggestions if isinstance(s, dict)]
    feedback = str(upstream.get("feedback") or "").strip()
    first_title = issues[0]["label"] if issues else ""
    first_body = issues[0]["feedback"] if issues else ""

    summary = first_body or feedback or (
        "No specific issues on this pass—your draft looks clean for quick spelling and clarity checks."
    )
    if len(issues) > 1 and first_body:
        summary = f"{first_title}: {first_body}"

    practice: list[str] = []
    for s in suggestions:
        if not isinstance(s, dict):
            continue
        me = s.get("micro_edit")
        if me is not None and str(me).strip():
            practice.append(str(me).strip())
    if not practice and issues:
        for item in issues[:3]:
            if item.get("fix"):
                practice.append(item["fix"])
    if not practice:
        practice = [
            "Rewrite one long sentence as two shorter ones.",
            "Replace one repeated word with a more specific verb.",
        ]

    next_step = (
        f"Focus on {issues[0]['label'].lower()} next."
        if issues
        else "Keep writing; run another pass after you pause."
    )

    out = dict(upstream)
    out.update(
        {
            "summary": summary[:2000],
            "level": _draft_level(draft),
            "issues": issues,
            "practicePrompts": practice[:5],
            "nextStep": next_step,
            "suggestions": suggestions,
        }
    )
    return out
