import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "writeup.sqlite");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    writing_level TEXT NOT NULL DEFAULT 'college',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    source_host TEXT,
    snippet_hash TEXT,
    snippet_preview TEXT,
    writing_level TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS flagged_terms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    term TEXT NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    reason TEXT,
    definition TEXT,
    synonyms_json TEXT,
    pedagogical_note TEXT,
    optional_rewrite TEXT,
    FOREIGN KEY (run_id) REFERENCES analysis_runs(id)
  );

  CREATE TABLE IF NOT EXISTS term_persistence (
    user_id TEXT NOT NULL,
    term_normalized TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, term_normalized)
  );

  CREATE INDEX IF NOT EXISTS idx_runs_user ON analysis_runs(user_id);
`);

export function ensureUser(userId, writingLevel) {
  const row = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!row) {
    db.prepare(
      "INSERT INTO users (id, writing_level) VALUES (?, ?)"
    ).run(userId, writingLevel);
  } else {
    db.prepare("UPDATE users SET writing_level = ? WHERE id = ?").run(
      writingLevel,
      userId
    );
  }
}

export function recordAnalysis({
  userId,
  writingLevel,
  sourceHost,
  snippet,
  items,
}) {
  const preview =
    snippet.length > 400 ? `${snippet.slice(0, 400)}…` : snippet;
  const hash = Buffer.from(snippet).toString("base64url").slice(0, 48);

  const run = db
    .prepare(
      `INSERT INTO analysis_runs (user_id, source_host, snippet_hash, snippet_preview, writing_level)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, sourceHost || null, hash, preview, writingLevel);

  const runId = run.lastInsertRowid;
  const insertFlag = db.prepare(
    `INSERT INTO flagged_terms (
      run_id, term, start_offset, end_offset, reason, definition, synonyms_json, pedagogical_note, optional_rewrite
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const upsertPersistence = db.prepare(`
    INSERT INTO term_persistence (user_id, term_normalized, hit_count, last_seen_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(user_id, term_normalized) DO UPDATE SET
      hit_count = hit_count + 1,
      last_seen_at = datetime('now')
  `);

  for (const it of items) {
    const term = String(it.term || "").trim();
    if (!term) continue;
    insertFlag.run(
      runId,
      term,
      Number.isInteger(it.start) ? it.start : null,
      Number.isInteger(it.end) ? it.end : null,
      it.reason || null,
      it.definition || null,
      JSON.stringify(it.synonyms || []),
      it.pedagogicalNote || null,
      it.optionalRewrite || null
    );
    upsertPersistence.run(userId, term.toLowerCase());
  }

  return { runId };
}

export function getLinguisticProfile(userId, limit = 16) {
  return db
    .prepare(
      `SELECT term_normalized AS term, hit_count AS count, last_seen_at AS lastSeen
       FROM term_persistence
       WHERE user_id = ?
       ORDER BY hit_count DESC, last_seen_at DESC
       LIMIT ?`
    )
    .all(userId, limit);
}

export { db };
