"""SQLite persistence for vocabulary upgrade history (prototype, local only)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "writeup.db"

_MAX_TERM_LEN = 120
_MAX_NOTE_LEN = 400


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vocab_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                low_term TEXT NOT NULL,
                suggested_term TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_vocab_low ON vocab_history (lower(low_term))"
        )
        conn.commit()
    finally:
        conn.close()


def insert_vocab_pairs(pairs: list[dict]) -> int:
    """Insert validated (from, to) pairs. Returns number of rows inserted."""
    if not pairs:
        return 0
    conn = get_connection()
    inserted = 0
    try:
        for p in pairs:
            low = (p.get("from") or "").strip()
            high = (p.get("to") or "").strip()
            note = (p.get("note") or "").strip()
            if not low or not high:
                continue
            if len(low) > _MAX_TERM_LEN or len(high) > _MAX_TERM_LEN:
                continue
            if low.lower() == high.lower():
                continue
            note = note[:_MAX_NOTE_LEN]
            conn.execute(
                "INSERT INTO vocab_history (low_term, suggested_term, note) VALUES (?, ?, ?)",
                (low, high, note or None),
            )
            inserted += 1
        conn.commit()
    finally:
        conn.close()
    return inserted


def vocabulary_context_for_prompt(max_rows: int = 50) -> str:
    """
    Aggregate past low_term -> suggested_term for injection into the system prompt.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT low_term, suggested_term, COUNT(*) AS cnt, MAX(created_at) AS last_at
            FROM vocab_history
            GROUP BY lower(trim(low_term)), lower(trim(suggested_term))
            ORDER BY last_at DESC
            LIMIT ?
            """,
            (max_rows,),
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return ""

    lines = []
    for r in rows:
        low = r["low_term"]
        high = r["suggested_term"]
        cnt = int(r["cnt"])
        lines.append(f'- Earlier you used "{low}" → we suggested "{high}" ({cnt}x logged).')
    return "\n".join(lines)


def get_word_bank(limit: int = 60) -> list[dict]:
    """
    Return recent/ frequent vocabulary upgrades for UI display.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT
              low_term,
              suggested_term,
              COALESCE(MAX(note), '') AS note,
              COUNT(*) AS cnt,
              MAX(created_at) AS last_at
            FROM vocab_history
            GROUP BY lower(trim(low_term)), lower(trim(suggested_term))
            ORDER BY last_at DESC, cnt DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    finally:
        conn.close()

    out: list[dict] = []
    for r in rows:
        out.append(
            {
                "from": r["low_term"],
                "to": r["suggested_term"],
                "note": r["note"] or "",
                "count": int(r["cnt"]),
                "last_at": r["last_at"],
            }
        )
    return out
