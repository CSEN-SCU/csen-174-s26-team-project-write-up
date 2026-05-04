"""
Sign-in email validation (webapp Profile page).

The Profile sign-in UI lives in ``webapp/src/pages/Profile.jsx``. Format checking
for the email field is delegated to the browser via ``<input type="email">``;
React only requires non-empty email and password before enabling submit.

These tests (1) lock in that wiring in source and (2) document acceptable vs
rejectable addresses using the same ``email.headerregistry.Address`` rules that
closely match strict email handling in user agents.
"""

import re
from email.errors import HeaderParseError
from email.headerregistry import Address
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_PROFILE_PAGE = _REPO_ROOT / "webapp" / "src" / "pages" / "Profile.jsx"


def _sign_in_email_format_ok(addr: str) -> bool:
    """Return True if ``addr`` is a syntactically valid addr-spec (RFC-style)."""
    s = (addr or "").strip()
    if not s:
        return False
    try:
        Address(addr_spec=s)
        return True
    except (ValueError, TypeError, HeaderParseError):
        return False


def test_profile_sign_in_email_input_uses_type_email():
    """Sign-in email field must use type=email so invalid formats are filtered by the browser."""
    assert _PROFILE_PAGE.is_file(), f"Missing {_PROFILE_PAGE}"
    src = _PROFILE_PAGE.read_text(encoding="utf-8")
    # Email field: id then type="email" (order may vary slightly in formatting)
    m = re.search(
        r'id\s*=\s*["\']profile-email["\'][^>]*type\s*=\s*["\']email["\']'
        r"|type\s*=\s*['\"]email['\"][^>]*id\s*=\s*['\"]profile-email['\"]",
        src,
        re.DOTALL,
    )
    assert m is not None, "profile-email input must use type=\"email\" for validation"


def test_sign_in_email_format_accepts_valid_addresses():
    for addr in (
        "you@school.edu",
        "writer@example.com",
        "a@b.co",
        "user.name+tag@domain.org",
    ):
        assert _sign_in_email_format_ok(addr), f"expected valid: {addr!r}"


def test_sign_in_email_format_rejects_invalid_addresses():
    for addr in (
        "",
        "   ",
        "not-an-email",
        "missing-at-sign.com",
        "@nodomain.local",
        "spaces bad@here.com",
    ):
        assert not _sign_in_email_format_ok(addr), f"expected invalid: {addr!r}"
