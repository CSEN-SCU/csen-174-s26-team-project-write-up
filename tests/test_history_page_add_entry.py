"""
Contract tests for the History page list behavior in the Vite/React webapp.

These read webapp/source and assert that the History view includes the markup and
handlers needed for a user to add entries (local demo list via "Add entry").
They do not start the dev server or run a browser, similar to
test_extension_navigation_bar.py.
"""

from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_HISTORY_JSX = _REPO_ROOT / "webapp" / "src" / "pages" / "History.jsx"


def test_history_jsx_can_add_demo_entries_to_local_list():
    """As a user, I use Add entry so new correction/mistake rows appear in the list."""
    assert _HISTORY_JSX.is_file(), f"Missing {_HISTORY_JSX}"
    src = _HISTORY_JSX.read_text(encoding="utf-8")

    assert 'const [items, setItems] = useState([])' in src
    assert "function addItem()" in src
    assert "setItems((prev) => {" in src
    assert "...prev," in src
    assert "DEMO_PAIRS[prev.length % DEMO_PAIRS.length]" in src
    assert "crypto.randomUUID()" in src

    assert 'type="button"' in src
    assert "history-page__add-btn" in src
    assert "Add entry" in src
    assert "onClick={addItem}" in src

    assert 'role="list"' in src and "history-page__container" in src
    assert 'role="listitem"' in src
    assert "items.map((item)" in src
    assert "{item.correction}" in src
    assert "{item.mistake}" in src
    assert "items.length === 0" in src
    assert "history-page__empty" in src
