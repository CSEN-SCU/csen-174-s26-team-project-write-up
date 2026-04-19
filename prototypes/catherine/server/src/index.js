import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

import { enrichWithGroq } from "./groq.js";
import { findWeakWordSpans, firstOccurrence } from "./heuristics.js";
import {
  ensureUser,
  recordAnalysis,
  getLinguisticProfile,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catherineRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(catherineRoot, ".env.catherine");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}

const PORT = Number(process.env.PORT || 3847);
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "";

const app = express();
app.use(express.json({ limit: "512kb" }));

const corsOrigins = new Set([
  "http://localhost:3847",
  "http://127.0.0.1:3847",
]);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (corsOrigins.has(origin)) return cb(null, true);
      if (origin.startsWith("chrome-extension://")) return cb(null, true);
      return cb(null, false);
    },
  })
);

function normalizeItems(text, aiItems, heuristicHits) {
  const byKey = new Map();

  for (const h of heuristicHits) {
    const key = h.term.toLowerCase();
    byKey.set(key, {
      term: h.term,
      start: h.start,
      end: h.end,
      reason: "",
      definition: "",
      synonyms: [],
      pedagogicalNote: "",
      optionalRewrite: "",
    });
  }

  for (const it of aiItems) {
    const key = it.term.toLowerCase();
    const occ =
      firstOccurrence(text, it.term) ||
      firstOccurrence(text, it.term.toLowerCase()) ||
      null;
    const prev = byKey.get(key) || {
      term: it.term,
      start: null,
      end: null,
      reason: "",
      definition: "",
      synonyms: [],
      pedagogicalNote: "",
      optionalRewrite: "",
    };
    byKey.set(key, {
      term: prev.term || it.term,
      start: prev.start ?? occ?.start ?? null,
      end: prev.end ?? occ?.end ?? null,
      reason: it.reason || prev.reason,
      definition: it.definition || prev.definition,
      synonyms: it.synonyms?.length ? it.synonyms : prev.synonyms,
      pedagogicalNote: it.pedagogicalNote || prev.pedagogicalNote,
      optionalRewrite: it.optionalRewrite || prev.optionalRewrite,
    });
  }

  for (const [, v] of byKey) {
    if (v.start == null || v.end == null) {
      const occ = firstOccurrence(text, v.term);
      if (occ) {
        v.start = occ.start;
        v.end = occ.end;
      }
    }
  }

  return [...byKey.values()].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

function sanitizeGrammarDictionary(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => ({
      wrong: String(e.wrong || e.wrongForm || "").trim().slice(0, 160),
      right: String(e.right || e.correct || "").trim().slice(0, 160),
      note: String(e.note || "").trim().slice(0, 220),
      rule: String(e.rule || "").trim().slice(0, 160),
    }))
    .filter((e) => e.wrong || e.right)
    .slice(0, 40);
}

function normalizeGrammarItems(text, raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      const term = String(g.term || "").trim();
      if (!term) return null;
      const occ =
        firstOccurrence(text, term) ||
        firstOccurrence(text, term.toLowerCase()) ||
        null;
      return {
        term,
        issue: String(g.issue || "").trim().slice(0, 600),
        fix: String(g.fix || "").trim().slice(0, 400),
        flowTip: String(g.flowTip || "").trim().slice(0, 300),
        start: occ?.start ?? null,
        end: occ?.end ?? null,
      };
    })
    .filter(Boolean);
}

/** Same shape as grammar rows (exact wrong span + issue + fix). */
function normalizeSpellingItems(text, raw) {
  return normalizeGrammarItems(text, raw);
}

/** One agreement/tense row: merge "She" + "are" → "She are" when spans are adjacent. */
function mergeAdjacentGrammarItems(text, items) {
  const withPos = items.filter(
    (g) =>
      Number.isInteger(g.start) &&
      Number.isInteger(g.end) &&
      g.end > g.start
  );
  const noPos = items.filter(
    (g) =>
      !Number.isInteger(g.start) ||
      !Number.isInteger(g.end) ||
      g.end <= g.start
  );
  if (!withPos.length) return items;
  withPos.sort((a, b) => a.start - b.start);
  const out = [{ ...withPos[0] }];
  for (let i = 1; i < withPos.length; i++) {
    const g = withPos[i];
    const prev = out[out.length - 1];
    const gap = g.start - prev.end;
    const between = text.slice(prev.end, g.start);
    if (gap >= 0 && gap <= 8 && /^[\s,;:'"—–\-]*$/.test(between)) {
      prev.end = g.end;
      prev.term = text.slice(prev.start, prev.end);
      prev.issue = [prev.issue, g.issue].filter(Boolean).join(" — ");
      if (!prev.fix) prev.fix = g.fix;
      else if (g.fix && !prev.fix.includes(g.fix)) prev.fix = `${prev.fix} ${g.fix}`.trim();
      prev.flowTip = [prev.flowTip, g.flowTip]
        .filter(Boolean)
        .join(" ")
        .slice(0, 450);
    } else {
      out.push({ ...g });
    }
  }
  return [...out, ...noPos];
}

/** Drop vocabulary cards whose span sits inside or overlaps a grammar span. */
function stripVocabOverlappingGrammar(items, grammarItems) {
  const spans = grammarItems
    .map((g) =>
      Number.isInteger(g.start) && Number.isInteger(g.end)
        ? { s: g.start, e: g.end }
        : null
    )
    .filter(Boolean);
  if (!spans.length) return items;
  return items.filter((it) => {
    if (!Number.isInteger(it.start) || !Number.isInteger(it.end)) return true;
    return !spans.some((sp) => !(it.end <= sp.s || it.start >= sp.e));
  });
}

const BARE_SUBJECT_PRONOUN_VOCAB = new Set(["she", "he", "they", "we", "it"]);

/** Remove vocabulary-only rows for bare subject pronouns (grammar owns agreement). */
function stripBarePronounVocabItems(items) {
  return items.filter((it) => {
    const t = String(it.term || "").trim();
    if (/[\s]/.test(t)) return true;
    const w = t.toLowerCase().replace(/[^a-z]/g, "");
    return !BARE_SUBJECT_PRONOUN_VOCAB.has(w);
  });
}

function sanitizePieceContext(raw) {
  return String(raw || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 500);
}

/** Short, human-readable API error for the extension UI. */
function summarizeAiError(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  if (/429|rate.?limit|Too Many Requests/i.test(s)) {
    return "Groq rate limit. Wait a moment, try again, or switch GROQ_MODEL in .env.catherine.";
  }
  if (/401|403|invalid.*api|unauthor/i.test(s)) {
    return "Groq API key rejected. Check GROQ_API_KEY in .env.catherine (console.groq.com).";
  }
  if (/TPM|tokens per minute|too large for model/i.test(s)) {
    const head = s.length > 180 ? `${s.slice(0, 180)}…` : s;
    return `${head} Tip: select a shorter passage, or in .env.catherine set GROQ_MAX_TOKENS=1024 and/or GROQ_PASSAGE_CHARS=4000 (defaults were lowered in the server).`;
  }
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Write Up API (Catherine)</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
    code { background: #f4f4f5; padding: 0.1em 0.35em; border-radius: 4px; }
    a { color: #0f766e; }
    ul { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Write Up API</h1>
  <p>This URL is the <strong>backend for the Chrome extension</strong>, not a full web app. There is no homepage UI here by design.</p>
  <p>Useful checks:</p>
  <ul>
    <li><a href="/health"><code>GET /health</code></a> — server and Groq config status</li>
    <li><code>POST /api/analyze</code> — called by the extension (JSON body: <code>userId</code>, <code>text</code>, <code>writingLevel</code>, optional <code>writingGoals</code>, optional <code>pieceContext</code> for genre/task)</li>
    <li><code>GET /api/profile/:userId</code> — linguistic persistence for the popup</li>
  </ul>
  <p>See <code>prototypes/catherine/README.md</code> for setup.</p>
</body>
</html>`);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ai: "groq",
    hasGroqKey: Boolean(GROQ_API_KEY),
    groqModel: GROQ_MODEL || "(default in groq.js)",
  });
});

app.get("/api/profile/:userId", (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const profile = getLinguisticProfile(userId);
  res.json({ profile });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const {
      userId,
      text,
      writingLevel = "college",
      sourceUrl = "",
      textAcquisition = "selection",
      writingGoals: rawGoals,
      pieceContext: rawPiece,
      grammarDictionary: rawGrammarDict,
    } = req.body || {};

    const writingGoals = Array.isArray(rawGoals)
      ? rawGoals.map((g) => String(g || "").trim()).filter(Boolean)
      : [];
    const pieceContext = sanitizePieceContext(rawPiece);
    const grammarDictionary = sanitizeGrammarDictionary(rawGrammarDict);

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId is required" });
    }
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      return res.status(400).json({ error: "text is too short" });
    }
    if (trimmed.length > 20000) {
      return res.status(400).json({ error: "text exceeds 20000 characters" });
    }

    ensureUser(userId, writingLevel);
    const heuristicHits = findWeakWordSpans(trimmed, writingLevel);

    let aiItems = [];
    let grammarItemsRaw = [];
    let spellingItemsRaw = [];
    let grammarFlow = "";
    let aiError = null;
    let aiProvider = "none";
    let groqPassageTruncated = false;
    let groqAnalyzedChars = 0;

    const acquisition = String(textAcquisition || "selection");

    if (GROQ_API_KEY) {
      try {
        const groqOut = await enrichWithGroq({
          apiKey: GROQ_API_KEY,
          model: GROQ_MODEL || undefined,
          text: trimmed,
          writingLevel,
          heuristicHits,
          textAcquisition: acquisition,
          writingGoals,
          pieceContext,
          grammarDictionary,
        });
        aiItems = Array.isArray(groqOut.items) ? groqOut.items : [];
        grammarItemsRaw = Array.isArray(groqOut.grammarItems)
          ? groqOut.grammarItems
          : [];
        spellingItemsRaw = Array.isArray(groqOut.spellingItems)
          ? groqOut.spellingItems
          : [];
        grammarFlow = String(groqOut.grammarFlow || "").trim();
        groqPassageTruncated = Boolean(groqOut.passageTruncated);
        groqAnalyzedChars = Number(groqOut.passageAnalyzedChars) || 0;
        aiProvider = "groq";
      } catch (e) {
        aiError = e instanceof Error ? e.message : String(e);
        aiItems = [];
        grammarItemsRaw = [];
        spellingItemsRaw = [];
        grammarFlow = "";
        aiProvider = "none";
      }
    }

    let spellingItems = normalizeSpellingItems(trimmed, spellingItemsRaw);
    let grammarItems = normalizeGrammarItems(trimmed, grammarItemsRaw);
    grammarItems = mergeAdjacentGrammarItems(trimmed, grammarItems);

    let items = normalizeItems(trimmed, aiItems, heuristicHits);
    items = stripVocabOverlappingGrammar(items, grammarItems);
    items = stripVocabOverlappingGrammar(items, spellingItems);
    items = stripBarePronounVocabItems(items);

    for (const it of items) {
      if (!it.reason) {
        it.reason =
          "Flagged as a common crutch word — aim for more specific language.";
      }
    }

    const DEFAULT_CLEAN =
      "No spelling, vocabulary, or grammar issues showed up for this passage at your level—it reads clearly. Keep going!";
    if (
      !grammarFlow &&
      !items.length &&
      !grammarItems.length &&
      !spellingItems.length &&
      !aiError &&
      aiProvider === "groq"
    ) {
      grammarFlow = DEFAULT_CLEAN;
    }
    let sourceHost = "";
    try {
      sourceHost = sourceUrl ? new URL(sourceUrl).hostname : "";
    } catch {
      sourceHost = "";
    }

    recordAnalysis({
      userId,
      writingLevel,
      sourceHost,
      snippet: trimmed,
      items,
    });

    const docHint =
      acquisition === "google_doc_body"
        ? "This text was read from the whole visible Google Doc (not your blue highlight). The model tries to ignore menus/UI; for an exact highlight use right-click → Analyze with Write Up, or Analyze clipboard after Ctrl+C."
        : "";
    const tpmHint =
      groqPassageTruncated && !aiError
        ? `Groq analyzed only the first ${groqAnalyzedChars.toLocaleString()} characters of this request to stay within token limits; analyze another chunk for the rest.`
        : "";
    const analysisHint = [docHint, tpmHint].filter(Boolean).join(" ") || null;

    res.json({
      items,
      spellingItems,
      grammarItems,
      grammarFlow,
      heuristicHitCount: heuristicHits.length,
      vocabularySource: "ai",
      usedAi: !aiError && aiProvider === "groq",
      aiProvider,
      aiError: summarizeAiError(aiError),
      writingLevel,
      writingGoals,
      pieceContext,
      textAcquisition: acquisition,
      analysisHint,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[write-up-catherine] API http://localhost:${PORT} (env: ${path.basename(envPath)})`
  );
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(
      `[write-up-catherine] Port ${PORT} is already in use (another server is probably still running).`
    );
    // eslint-disable-next-line no-console
    console.error(
      `Fix: stop that process, or set PORT=3848 in .env.catherine and match the URL in the extension popup (and manifest host_permissions if needed).`
    );
    // eslint-disable-next-line no-console
    console.error(
      `Windows (find PID): netstat -ano | findstr :${PORT}`
    );
    // eslint-disable-next-line no-console
    console.error(`Windows (stop):   taskkill /PID <pid> /F`);
    process.exit(1);
  }
  throw err;
});
