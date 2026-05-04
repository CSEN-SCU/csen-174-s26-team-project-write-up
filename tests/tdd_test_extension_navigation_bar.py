"""
Contract tests for the Write Up Chrome extension side panel.

The visible navigation between main views is the tab bar (Feedback / Word Bank).
These tests assert that markup and default styles for that bar are present so it
can render in the side panel (DOM + CSS contract). They do not launch Chrome.

Run: python -m pytest tests/test_extension_navigation_bar.py -v
"""

from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SIDEPANEL_HTML = _REPO_ROOT / "extension" / "src" / "sidepanel" / "sidepanel.html"
_SIDEPANEL_CSS = _REPO_ROOT / "extension" / "src" / "sidepanel" / "sidepanel.css"


def test_sidepanel_html_includes_navigation_tab_bar():
    """As a user, I see Feedback and Word Bank tabs so I can switch sidebar views."""
    assert _SIDEPANEL_HTML.is_file(), f"Missing {_SIDEPANEL_HTML}"
    html = _SIDEPANEL_HTML.read_text(encoding="utf-8")
    assert 'class="tabbar"' in html
    assert 'role="tablist"' in html
    assert 'aria-label="Write Up sidebar views"' in html
    assert 'id="tab-feedback"' in html
    assert 'id="tab-wordbank"' in html
    assert "Feedback" in html
    assert "Word Bank" in html


def test_sidepanel_css_shows_tab_bar_by_default():
    """Tab bar stylesheet keeps the bar visible (not display:none)."""
    assert _SIDEPANEL_CSS.is_file(), f"Missing {_SIDEPANEL_CSS}"
    css = _SIDEPANEL_CSS.read_text(encoding="utf-8")
    assert ".tabbar" in css
    start = css.find(".tabbar")
    assert start != -1, ".tabbar rule not found in sidepanel.css"
    brace = css.find("{", start)
    end = css.find("}", brace)
    assert brace != -1 and end != -1, ".tabbar rule block not parseable"
    block = css[brace : end + 1]
    assert "display: flex" in block or "display:flex" in block.replace(" ", "")
    assert "display: none" not in block


def test_active_navigation_tab_announces_current_for_assistive_tech():
    """As a user relying on a screen reader, the active tab exposes aria-current (TDD RED)."""
    html = _SIDEPANEL_HTML.read_text(encoding="utf-8")
    assert 'aria-current="true"' in html or 'aria-current="page"' in html, (
        "Mark the active tab with aria-current so assistive tech knows which view is open."
    )


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
