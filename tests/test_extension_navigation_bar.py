"""
Contract tests for the Write Up Chrome extension side panel.

The visible navigation between main views is the tab bar (Feedback / Word Bank).
These tests assert that markup and default styles for that bar are present so it
can render in the side panel (DOM + CSS contract). They do not launch Chrome.
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
    block = css[start : start + 120]
    assert "display: flex" in block
    assert "display: none" not in block
