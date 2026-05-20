#!/usr/bin/env python3
"""Print Firebase Admin env status for the current APP_ENV (loads root + app-api .env)."""

from __future__ import annotations

import sys
from pathlib import Path

_APP_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _APP_DIR.parents[1]

if str(_APP_DIR) not in sys.path:
    sys.path.insert(0, str(_APP_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_REPO_ROOT / ".env")
load_dotenv(_APP_DIR / ".env", override=True)

from firebase.init import firebase_credentials_status  # noqa: E402


def main() -> int:
    st = firebase_credentials_status()
    print(f"APP_ENV={st['app_env']}")
    if st["configured"]:
        print(f"OK: Firebase Admin credentials found (source={st['source']})")
        return 0
    print("FAIL: Firebase Admin credentials missing")
    if st.get("hint"):
        print(st["hint"])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
