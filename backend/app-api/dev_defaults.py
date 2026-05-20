"""Apply safe local-dev defaults when APP_ENV is dev/test (setdefault only)."""

from __future__ import annotations

import os


def apply_dev_defaults() -> None:
    env = os.environ.get("APP_ENV", "dev").strip().lower()
    if env not in ("dev", "test"):
        return
    os.environ.setdefault("APP_AUTH_BYPASS", "1")
    os.environ.setdefault("APP_LOCAL_DEV_STORE", "1")
    os.environ.setdefault(
        "COACHING_INTERNAL_SECRET",
        "dev-local-coaching-secret-change-me",
    )
    os.environ.setdefault("COACHING_API_BASE_URL", "http://127.0.0.1:8787")
