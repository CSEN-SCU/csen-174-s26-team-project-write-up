"""
Saved grammar rules — viewing (TDD / aspirational).

Intended behavior: a signed-in learner can open a dedicated place in the webapp
that lists grammar rules they have saved, backed by an API that returns those rules.

This module is intentionally RED: the product surface is not implemented yet. Do not
``xfail`` here; the failure is the signal to implement the route, nav link, page,
and backend contract.
"""

import re
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
_APP_JSX = _REPO / "webapp" / "src" / "App.jsx"
_GRAMMAR_RULES_PAGE = _REPO / "webapp" / "src" / "pages" / "GrammarRules.jsx"
_APP_API = _REPO / "backend" / "app-api" / "app.py"


def test_user_can_view_saved_grammar_rules():
    """As a learner, I use the webapp to see my saved grammar rules in one place."""
    assert _APP_JSX.is_file()
    app_src = _APP_JSX.read_text(encoding="utf-8")

    assert re.search(r"path\s*=\s*[\"']/grammar-rules[\"']", app_src), (
        "Register a <Route> for /grammar-rules (or equivalent) so the list view is reachable."
    )
    assert re.search(r"to\s*=\s*[\"']/grammar-rules[\"']", app_src), (
        "Expose a <Link> in the shell nav so users can open saved grammar rules."
    )
    assert _GRAMMAR_RULES_PAGE.is_file(), (
        "Add a page component (e.g. GrammarRules.jsx) that renders the user's saved rules."
    )

    assert _APP_API.is_file()
    api_src = _APP_API.read_text(encoding="utf-8")
    assert re.search(r"grammar[_-]?rules|/grammar-rules", api_src, re.IGNORECASE), (
        "Register a Flask blueprint or route that serves saved grammar rules for the UI."
    )
