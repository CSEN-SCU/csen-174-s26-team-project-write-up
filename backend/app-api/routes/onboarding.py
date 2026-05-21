"""Merge onboarding answers into the authenticated user's Firestore profile."""

from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from firebase.init import get_db

bp = Blueprint("onboarding", __name__)


@bp.post("/onboarding")
@require_auth
def onboarding_create():
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify(ok=False, error="invalid_body"), 400

    now = datetime.now(timezone.utc).isoformat()
    sample = body.get("writingSample")
    if isinstance(sample, str):
        sample = sample.strip()[:24000]

    patch = {
        "userId": g.user_id,
        "onboardingComplete": True,
        "onboardingAt": now,
        "updatedAt": now,
    }
    if sample:
        patch["onboardingWritingSample"] = sample
    if body.get("goals") is not None:
        patch["onboardingGoals"] = body.get("goals")
    if body.get("experienceLevel") is not None:
        patch["onboardingExperienceLevel"] = str(body.get("experienceLevel"))[:120]

    try:
        get_db().collection("users").document(g.user_id).set(patch, merge=True)
        return jsonify(ok=True), 200
    except Exception:
        return jsonify(ok=False, error="internal_error"), 500
