import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nspell from "nspell";
import dictionaryEn from "dictionary-en";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_CHRIS_ROOT = path.join(__dirname, "..", ".env");
const ENV_SERVER_DIR = path.join(__dirname, ".env");
if (existsSync(ENV_CHRIS_ROOT)) {
  dotenv.config({ path: ENV_CHRIS_ROOT });
  console.log(`Loaded env from ${ENV_CHRIS_ROOT}`);
} else if (existsSync(ENV_SERVER_DIR)) {
  dotenv.config({ path: ENV_SERVER_DIR });
  console.log(`Loaded env from ${ENV_SERVER_DIR}`);
} else {
  dotenv.config();
  console.warn(
    `No .env found at ${ENV_CHRIS_ROOT} or ${ENV_SERVER_DIR} — set keys in the environment or create one of those files (see .env.example is template-only, not loaded).`,
  );
}

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_API_BASE = (process.env.GROQ_API_BASE || "https://api.groq.com/openai/v1").replace(/\/$/, "");
/** Default: Llama 3.3 70B Versatile (strong English + instruction following for writing coach). Override with GROQ_MODEL. */
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
/** Which LLM to try first: auto (Groq if set, else OpenAI), groq, openai. Others are fallbacks when the first fails or returns no cards. */
const COACH_LLM = String(process.env.COACH_LLM || "auto").toLowerCase();
const KNOWLEDGE_DIR = path.join(__dirname, "knowledge");
const DATA_DIR = path.join(__dirname, "data");
const PROFILE_PATH = path.join(DATA_DIR, "profile-store.json");
const DOCUMENTS_PATH = path.join(DATA_DIR, "documents-store.json");
const WEB_DIST = path.join(__dirname, "..", "web", "dist");

/** Hunspell-backed checker (dictionary-en); null if init fails. */
let spellchecker = null;
try {
  spellchecker = nspell(dictionaryEn);
} catch (e) {
  console.warn("Spellchecker unavailable:", e?.message || e);
}

/** Informal / internet / dialect tokens Hunspell may flag—do not nag. */
const SPELL_ALLOW = new Set(
  `omg lol lmao rofl imo tbh idk btw fr frfr ngl irl ig u ur bc cos cuz tho thru pls plz ppl ok okay yep nah huh hmm hm er um uh kinda sorta gonna wanna gotta hell damn darn shoot dang heck yeet sus cap fax nope haha hahaha woah whoa yall ya'll gonna cv api css html js ts jpg png gif pdf url uri sql dns tcp http https www com org net io co uk app apps ios android`
    .split(/\s+/),
);

const RAG_TOP_K = 8;

const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "512kb" }));

/** @type {{ id: string, source: string, text: string }[]} */
let corpus = [];
/** @type {Map<string, { df: number, idf: number }>} */
let vocabStats = new Map();
/** @type {Map<string, Map<string, number>>} */
let tfByChunk = new Map();

const HEDGE_WORDS = ["like", "basically", "literally", "honestly", "actually", "kind", "sort"];

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildTf(tokens) {
  const tf = new Map();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  const max = Math.max(...tf.values(), 1);
  for (const [k, v] of tf) {
    tf.set(k, v / max);
  }
  return tf;
}

async function loadCorpus() {
  const files = await fs.readdir(KNOWLEDGE_DIR).catch(() => []);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const chunks = [];
  let i = 0;
  for (const file of mdFiles) {
    const raw = await fs.readFile(path.join(KNOWLEDGE_DIR, file), "utf8");
    const parts = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      chunks.push({ id: `${file}#${i++}`, source: file, text: p });
    }
  }
  corpus = chunks;

  const df = new Map();
  for (const chunk of corpus) {
    const toks = new Set(tokenize(chunk.text));
    for (const t of toks) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const N = Math.max(corpus.length, 1);
  vocabStats = new Map();
  for (const [term, dfi] of df) {
    const idf = Math.log((N + 1) / (dfi + 1)) + 1;
    vocabStats.set(term, { df: dfi, idf });
  }

  tfByChunk = new Map();
  for (const chunk of corpus) {
    const tf = buildTf(tokenize(chunk.text));
    tfByChunk.set(chunk.id, tf);
  }
}

function tfidfVector(tf) {
  const vec = new Map();
  for (const [term, w] of tf) {
    const idf = vocabStats.get(term)?.idf ?? 0;
    vec.set(term, w * idf);
  }
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  const smaller = a.size < b.size ? a : b;
  const other = a.size < b.size ? b : a;
  for (const [term, va] of smaller) {
    if (!other.has(term)) continue;
    dot += va * other.get(term);
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function retrieve(queryText, topK = 5) {
  const qTf = buildTf(tokenize(queryText));
  const qVec = tfidfVector(qTf);
  const scored = corpus.map((chunk) => {
    const cVec = tfidfVector(tfByChunk.get(chunk.id));
    return { chunk, score: cosine(qVec, cVec) };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, topK).filter((s) => s.score > 0);
}

/** Merge ranked chunk lists by max score per id (stronger RAG than a single full-document query). */
function mergeRetrievalResults(lists, topK) {
  const byId = new Map();
  for (const list of lists) {
    for (const item of list) {
      const id = item.chunk.id;
      const prev = byId.get(id);
      const score = Math.max(prev?.score ?? 0, item.score);
      byId.set(id, { chunk: item.chunk, score });
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

/** Build a short synthetic query from likely misspellings so retrieval pulls grammar/spelling teaching chunks. */
function buildRagAugmentQuery(draftText) {
  if (!spellchecker) return "";
  const spell = spellchecker;
  const lower = String(draftText).toLowerCase();
  const words = [...new Set(lower.match(/\b[a-z]{4,}\b/g) || [])];
  const fixes = [];
  for (const w of words) {
    if (SPELL_ALLOW.has(w)) continue;
    if (spell.correct(w)) continue;
    const sug = spell.suggest(w);
    if (sug?.length) fixes.push(`${w} ${sug[0]}`);
    if (fixes.length >= 6) break;
  }
  if (!fixes.length) return "";
  return `${fixes.join(" ")} spelling grammar punctuation clarity reader-centered coaching`;
}

/** Multi-query TF–IDF: full draft, tail window, and spelling-augmented query. */
function retrieveForWritingCoach(draftText) {
  const trimmed = String(draftText).trim();
  const main = retrieve(trimmed, RAG_TOP_K);
  const tail = trimmed.slice(-Math.min(520, trimmed.length));
  const tailHits =
    tail.length >= 100 && tail !== trimmed ? retrieve(tail, Math.min(6, RAG_TOP_K)) : [];
  const aug = buildRagAugmentQuery(trimmed);
  const augHits = aug ? retrieve(`${trimmed.slice(0, 2400)}\n${aug}`, 6) : [];
  return mergeRetrievalResults([main, tailHits, augHits], RAG_TOP_K);
}

/** Dictionary-based spelling cards (complements LLM + small regex list). */
function spellDictionarySuggestions(text) {
  if (!spellchecker) return [];
  const spell = spellchecker;
  const t = String(text);
  const seen = new Set();
  const cards = [];
  for (const m of t.matchAll(/\b([a-zA-Z]{4,})\b/g)) {
    const raw = m[1];
    const lw = raw.toLowerCase();
    if (SPELL_ALLOW.has(lw)) continue;
    if (seen.has(lw)) continue;
    if (/^[A-Z]{2,}$/.test(raw)) continue;
    if (spell.correct(lw)) continue;
    const sug = spell.suggest(lw);
    if (!sug?.length) continue;
    seen.add(lw);
    cards.push({
      type: "grammar",
      title: `Spelling: “${raw}”`,
      body: `Likely typo—dictionary suggests **${sug[0]}**${sug[1] ? ` or *${sug[1]}*` : ""}. Pick the word that matches your meaning; keep your tone.`,
      micro_edit: sug[0],
    });
    if (cards.length >= 6) break;
  }
  return cards;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readProfileStore() {
  try {
    const raw = await fs.readFile(PROFILE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function createEmptyProfile() {
  return {
    requests: 0,
    totalWords: 0,
    totalSentences: 0,
    longSentenceCount: 0,
    commaSpliceSignals: 0,
    repeatedPunctuationSignals: 0,
    missingTerminalPunctuationSignals: 0,
    doubleSpaceSignals: 0,
    contractionCount: 0,
    firstPersonCount: 0,
    hedgeCounts: {},
    updatedAt: null,
  };
}

function countMatches(text, regex) {
  const m = String(text || "").match(regex);
  return m ? m.length : 0;
}

function analyzeWritingSignals(text) {
  const trimmed = String(text || "").trim();
  const sentenceParts = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentences = sentenceParts.length ? sentenceParts : (trimmed ? [trimmed] : []);
  const words = tokenize(trimmed);
  const wordCount = words.length;

  const sentenceWordCounts = sentences.map((s) => tokenize(s).length).filter((n) => n > 0);
  const longSentenceCount = sentenceWordCounts.filter((n) => n >= 30).length;

  const commaSpliceSignals = countMatches(trimmed, /\b[^.!?\n]{6,},\s+[a-z]+\s+(?:i|you|we|they|he|she|it)\b/gi);
  const repeatedPunctuationSignals = countMatches(trimmed, /[!?]{2,}|\.{4,}/g);
  const doubleSpaceSignals = countMatches(trimmed, / {2,}/g);

  let missingTerminalPunctuationSignals = 0;
  for (const s of sentences) {
    const looksLikeSentence = tokenize(s).length >= 7;
    if (!looksLikeSentence) continue;
    if (!/[.!?]$/.test(s)) missingTerminalPunctuationSignals += 1;
  }

  const contractionCount = countMatches(trimmed, /\b\w+'(?:t|s|m|re|ve|ll|d)\b/gi);
  const firstPersonCount = countMatches(trimmed, /\b(i|me|my|mine|we|our|ours|us)\b/gi);

  const hedgeCounts = {};
  for (const h of HEDGE_WORDS) {
    const c = countMatches(trimmed, new RegExp(`\\b${h}\\b`, "gi"));
    if (c > 0) hedgeCounts[h] = c;
  }

  return {
    wordCount,
    sentenceCount: sentences.length,
    longSentenceCount,
    commaSpliceSignals,
    repeatedPunctuationSignals,
    missingTerminalPunctuationSignals,
    doubleSpaceSignals,
    contractionCount,
    firstPersonCount,
    hedgeCounts,
  };
}

function mergeProfile(profile, signals) {
  const next = { ...(profile || createEmptyProfile()) };
  next.requests += 1;
  next.totalWords += signals.wordCount;
  next.totalSentences += signals.sentenceCount;
  next.longSentenceCount += signals.longSentenceCount;
  next.commaSpliceSignals += signals.commaSpliceSignals;
  next.repeatedPunctuationSignals += signals.repeatedPunctuationSignals;
  next.missingTerminalPunctuationSignals += signals.missingTerminalPunctuationSignals;
  next.doubleSpaceSignals += signals.doubleSpaceSignals;
  next.contractionCount += signals.contractionCount;
  next.firstPersonCount += signals.firstPersonCount;
  next.updatedAt = new Date().toISOString();

  const hedge = { ...(next.hedgeCounts || {}) };
  for (const [term, count] of Object.entries(signals.hedgeCounts || {})) {
    hedge[term] = (hedge[term] || 0) + count;
  }
  next.hedgeCounts = hedge;
  return next;
}

function summarizeProfile(profile) {
  const p = profile || createEmptyProfile();
  const totalSentences = Math.max(p.totalSentences, 1);
  const totalTokensForVoice = Math.max(p.totalWords, 1);

  const avgSentenceLength = p.totalWords / totalSentences;
  const longSentenceRate = p.longSentenceCount / totalSentences;
  const contractionRate = p.contractionCount / totalTokensForVoice;
  const firstPersonRate = p.firstPersonCount / totalTokensForVoice;

  const sortedHedges = Object.entries(p.hedgeCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([term, count]) => ({ term, count }));

  return {
    requests: p.requests,
    avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
    longSentenceRate: Number(longSentenceRate.toFixed(3)),
    contractionRate: Number(contractionRate.toFixed(3)),
    firstPersonRate: Number(firstPersonRate.toFixed(3)),
    commaSpliceSignals: p.commaSpliceSignals,
    repeatedPunctuationSignals: p.repeatedPunctuationSignals,
    missingTerminalPunctuationSignals: p.missingTerminalPunctuationSignals,
    doubleSpaceSignals: p.doubleSpaceSignals,
    topHedges: sortedHedges,
    updatedAt: p.updatedAt,
  };
}

async function readDocumentsStore() {
  try {
    const raw = await fs.readFile(DOCUMENTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.documents) ? parsed : { documents: [] };
  } catch {
    return { documents: [] };
  }
}

async function writeDocumentsStore(store) {
  await ensureDataDir();
  await fs.writeFile(DOCUMENTS_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function appendProfile(userId, summary, signals) {
  await ensureDataDir();
  const store = await readProfileStore();
  const prev = store[userId] || { notes: [], profile: createEmptyProfile(), updatedAt: null };
  prev.notes = Array.isArray(prev.notes) ? prev.notes : [];
  prev.notes.push({ at: new Date().toISOString(), summary });
  if (prev.notes.length > 40) {
    prev.notes = prev.notes.slice(prev.notes.length - 40);
  }
  prev.profile = mergeProfile(prev.profile, signals || analyzeWritingSignals(""));
  prev.updatedAt = new Date().toISOString();
  store[userId] = prev;
  await fs.writeFile(PROFILE_PATH, JSON.stringify(store, null, 2), "utf8");
  return summarizeProfile(prev.profile);
}

/** High-confidence spelling / agreement nits the LLM often skips—prepended after each coach pass. */
function obviousSpellingGrammarHeuristics(text) {
  const t = String(text || "");
  const out = [];
  const add = (card) => {
    if (card?.title) out.push(card);
  };

  if (/\bpregnate\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “pregnate”",
      body: "Standard spelling is **pregnant** (expecting a baby).",
      micro_edit: "pregnant",
    });
  }
  if (/\bbrib(es|ed|ing|e)?\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “brib”",
      body: "Use **bribe** for the verb/noun (offer money improperly).",
      micro_edit: "bribe",
    });
  }
  if (/\bdeat\b/i.test(t)) {
    add({
      type: "clarity",
      title: "Word check: “deat”",
      body: "Readers will stumble here. Common fixes: **dead**, **debt**, or **deaf**—pick the one you mean.",
      micro_edit: null,
    });
  }
  if (/\bthere\s+is\s+so\s+many\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Grammar: “there is” with a plural",
      body: "**Many things** are plural, so standard English uses **there are** (not *there is*).",
      micro_edit: "There are so many",
    });
  }
  if (/\bthere\s+is\s+many\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Grammar: “there is many”",
      body: "Use **there are many** so the verb agrees with the plural subject.",
      micro_edit: null,
    });
  }
  if (/\bdefinately\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “definately”",
      body: "Standard spelling is **definitely**.",
      micro_edit: "definitely",
    });
  }
  if (/\brecieve\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “recieve”",
      body: "Standard spelling is **receive** (i before e except after c pattern does not apply here).",
      micro_edit: "receive",
    });
  }
  if (/\boccured\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “occured”",
      body: "Standard spelling is **occurred** (double r).",
      micro_edit: "occurred",
    });
  }
  if (/\bseperate\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “seperate”",
      body: "Standard spelling is **separate**.",
      micro_edit: "separate",
    });
  }
  if (/\bteh\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Typo: “teh”",
      body: "Looks like **the** with letters swapped.",
      micro_edit: "the",
    });
  }
  if (/\byour\s+welcome\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Phrase: “your welcome”",
      body: "For “you are welcome,” use the contraction **you're**.",
      micro_edit: "You're welcome",
    });
  }
  return out.slice(0, 5);
}

/**
 * @param {string} text
 * @param {"typing" | "paused"} mode typing = spelling/grammar-safe mid-draft; paused = full pass including punctuation/coherence.
 */
function heuristicSuggestions(text, mode = "paused") {
  const suggestions = [];
  const pausedOnly = mode === "paused";

  if (pausedOnly) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) {
      const longOnes = sentences.filter((s) => s.split(/\s+/).length > 40);
      if (longOnes.length) {
        suggestions.push({
          type: "coherence",
          title: "Very long sentence(s)",
          body:
            "Readers track one main idea per sentence. Try splitting the longest sentence into two: keep your voice, but give each sentence a single job.",
          micro_edit: null,
        });
      }
    }
    const words = tokenize(text);
    const filler = HEDGE_WORDS;
    const counts = new Map();
    for (const w of words) {
      if (filler.includes(w)) counts.set(w, (counts.get(w) || 0) + 1);
    }
    for (const [w, c] of counts) {
      if (c >= 3) {
        suggestions.push({
          type: "pattern",
          title: `Repeated hedge/filler: “${w}”`,
          body:
            "This is often how people talk—and that is fine. If it clusters, readers may read it as uncertainty. Try cutting half of them on a second pass, not all.",
          micro_edit: null,
        });
        break;
      }
    }
  }

  if (text.includes("  ")) {
    suggestions.push({
      type: "clarity",
      title: "Extra spaces",
      body: "Small formatting glitches can distract in polished contexts. Not a voice issue—just cleanup.",
      micro_edit: null,
    });
  }

  if (pausedOnly) {
    const punctClusters = countMatches(text, /[!?]{2,}|\.{4,}/g);
    if (punctClusters > 0) {
      suggestions.push({
        type: "punctuation",
        title: "Repeated punctuation clusters",
        body:
          "Repeated punctuation can be expressive. In formal or mixed audiences, reserve it for emphasis points so your main ideas still read as precise.",
        micro_edit: null,
      });
    }
  }

  const commaSplice = String(text).match(/\b[^.!?\n]{6,},\s+[a-z]+\s+(?:i|you|we|they|he|she|it)\b/i);
  if (commaSplice) {
    suggestions.push({
      type: "grammar",
      title: "Possible comma splice",
      body:
        "A comma may be joining two full thoughts. Try a period, semicolon, or a connector (for example, because/so) to keep your logic clear.",
      micro_edit: null,
    });
  }

  return suggestions.slice(0, 5);
}

const DRAFTING_MODE_APPEND = `

--- MODE: DRAFTING (user may be mid-sentence) ---
The excerpt may end mid-thought or mid-sentence. Your job here is spelling and grammar that are visible **right now**:
- Call out **obvious misspellings** (wrong letters, common confusions like “pregnate”, “recieve”, “definately”)—quote the wrong word in the title or body and give the standard spelling.
- Call out **clear agreement / word-form errors** that do not need the rest of the paragraph (e.g. “there is so many” → “there are so many”).
- You may give 1–4 suggestions when those issues exist.

Do NOT give suggestions about: sentence-ending punctuation, missing periods only because the excerpt ends mid-line, “incomplete” last clauses, paragraph breaks, or global flow.

If USER TEXT contains at least one clear misspelling or agreement error of the kinds above, you MUST return at least one suggestion naming it. Return an empty array only when there are genuinely zero such issues in the visible text.
In this MODE, ignore any instruction elsewhere in this prompt to always produce 3–5 suggestions or to avoid “nitpicky” spelling callouts—here, spelling and agreement ARE the priority.`;

function coachMessages(text, retrieved, profileNotes, profileSnapshot, coachMode = "paused") {
  const ctx = retrieved
    .map((r) => `- (${r.chunk.id}) ${r.chunk.text}`)
    .join("\n");
  const profile =
    profileNotes?.length ? `User pattern notes (do not contradict):\n- ${profileNotes.slice(-5).join("\n- ")}` : "";

  const profileLine = profileSnapshot
    ? `Current profile snapshot: avgSentenceLength=${profileSnapshot.avgSentenceLength}; longSentenceRate=${profileSnapshot.longSentenceRate}; contractionRate=${profileSnapshot.contractionRate}; firstPersonRate=${profileSnapshot.firstPersonRate}; commaSpliceSignals=${profileSnapshot.commaSpliceSignals}; missingTerminalPunctuationSignals=${profileSnapshot.missingTerminalPunctuationSignals}; topHedges=${(profileSnapshot.topHedges || []).map((h) => `${h.term}:${h.count}`).join(",") || "none"}`
    : "";

  const system = `You are Write Up, a sophisticated writing coach for drafts that may be informal, spoken, or literary. Your job is to help the reader understand the writer better—not to flatten personality into generic “correct” prose.

Voice and stance (non-negotiable):
- Preserve dialect, attitude, humor, emotional heat, and first-person energy. Never scold the writer for sounding casual if the meaning lands.
- Treat CONTEXT snippets as *teaching material* (principles and examples), not a style to paste over the user. Quote ideas, not wording, unless a micro_edit is truly helpful.
- PROFILE aggregates describe habits across time; use them only to avoid contradicting the writer’s established voice unless the USER TEXT clearly needs a fix.

How to give feedback:
- Prefer **one precise observation + why it matters to a reader** over a list of rules. Separate “pattern / structure” from “local typo / agreement” when both exist.
- When you suggest a wording change, frame it as *optional* and keep it minimal—one clause or sentence, not a full rewrite.
- Call out spelling or agreement errors when they would confuse a reader or break trust; skip pedantic fixes that do not change comprehension.
- Do NOT rewrite the whole passage. Do NOT produce polished “essay voice” unless asked.
- Give 3–5 concrete suggestions when MODE is full (paused); follow MODE instructions when drafting (typing).
- Include a grammar or punctuation suggestion only when USER TEXT clearly shows that issue (do not invent one to fill a quota). Informal fragments like “Woah”, interjections, and casual tone are allowed when meaning is clear.
- Do NOT claim “missing sentence-ending punctuation” if every sentence in USER TEXT already ends with . ! or ? (ignore trailing spaces). Never use micro_edit to paste the whole passage with only a trailing period added.
- Do NOT use the title “Possible sentence-ending punctuation miss” for live reactions, diary/journal voice, fiction beats, or lines that already end with . ! ? including intentional fragments like “I think she will probably.” Treat trailing soft words (probably, maybe, like) before a period as valid voice unless the clause is genuinely unfinished with no terminal mark at all.
- Do not repeat the same narrow punctuation tip across refreshes if USER TEXT has not clearly introduced a new error of that kind.
- PROFILE snapshot fields are lifetime aggregates across many drafts; do not treat them as proof the current passage has that defect unless you can point to it in USER TEXT.
- Each suggestion must include a short “why” tied to reader understanding.
- Optional micro_edit: one small alternative phrasing for ONE clause/sentence only, not mandatory.
- Use the CONTEXT snippets as teaching references, not as rules to copy verbatim.
- Use PROFILE data to preserve the writer's voice while choosing the smallest high-impact edits.

Output strictly as JSON: {"suggestions":[{"type":"pattern|coherence|clarity|grammar|punctuation|voice","title":"","body":"","micro_edit":null|string}]}`;

  const systemFinal = coachMode === "typing" ? `${system}${DRAFTING_MODE_APPEND}` : system;

  const user = `USER TEXT:\n${text}\n\nCONTEXT:\n${ctx}\n\n${profile}\n\n${profileLine}`;
  return { system: systemFinal, user };
}

function filterSuggestionsForCoachMode(suggestions, coachMode) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (coachMode !== "typing") return list;
  return list.filter((s) => {
    const type = String(s?.type || "").toLowerCase();
    if (type === "punctuation") return false;
    const title = String(s?.title || "").toLowerCase();
    if (
      title.includes("sentence-ending") ||
      title.includes("terminal punctuation") ||
      title.includes("end without punctuation") ||
      title.includes("missing period")
    ) {
      return false;
    }
    return true;
  });
}

function resolveCoachLlmAttempts() {
  /** @type {{ id: string, label: string, apiKey: string, baseUrl: string, model: string }[]} */
  const groq = GROQ_API_KEY
    ? [{ id: "groq", label: "Groq", apiKey: GROQ_API_KEY, baseUrl: GROQ_API_BASE, model: GROQ_MODEL }]
    : [];
  const openai = OPENAI_API_KEY
    ? [{ id: "openai", label: "OpenAI", apiKey: OPENAI_API_KEY, baseUrl: "https://api.openai.com/v1", model: OPENAI_MODEL }]
    : [];

  if (COACH_LLM === "openai") return [...openai, ...groq];
  if (COACH_LLM === "groq") return [...groq, ...openai];
  return [...groq, ...openai];
}

async function coachWithChatCompletions(text, retrieved, profileNotes, profileSnapshot, cfg, coachMode = "paused") {
  const { system, user } = coachMessages(text, retrieved, profileNotes, profileSnapshot, coachMode);
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: coachMode === "typing" ? 0.22 : 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${cfg.label} error: ${err}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  return filterSuggestionsForCoachMode(rawList, coachMode);
}

/** Drop duplicate cards so the UI does not loop the same title on every refresh. */
function dedupeSuggestionTitles(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const s of items) {
    const key = String(s?.title || "").trim().toLowerCase();
    if (!key) {
      out.push(s);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

app.get("/health", (_req, res) => {
  const attempts = resolveCoachLlmAttempts();
  res.json({
    ok: true,
    chunks: corpus.length,
    hasOpenAI: Boolean(OPENAI_API_KEY),
    hasGroq: Boolean(GROQ_API_KEY),
    coachLlm: COACH_LLM,
    coachLlmOrder: attempts.map((a) => a.id),
    hasCoachLlm: attempts.length > 0,
    groqModel: GROQ_MODEL,
    openaiModel: OPENAI_MODEL,
    spellchecker: Boolean(spellchecker),
    ragTopK: RAG_TOP_K,
  });
});

app.post("/coach", async (req, res) => {
  try {
    const { text, userId = "anonymous", surface = "web", coachMode: rawMode } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }
    const coachMode = rawMode === "typing" ? "typing" : "paused";
    const trimmed = text.slice(0, 12000);
    const retrieved = retrieveForWritingCoach(trimmed);
    const store = await readProfileStore();
    const profileNotes = store[userId]?.notes?.map((n) => n.summary) || [];
    const existingProfile = store[userId]?.profile || createEmptyProfile();
    const signals = analyzeWritingSignals(trimmed);
    const predictedProfile = summarizeProfile(mergeProfile(existingProfile, signals));

    const heur = heuristicSuggestions(trimmed, coachMode);
    let llmCards = [];
    const attempts = resolveCoachLlmAttempts();
    for (const cfg of attempts) {
      try {
        const ai = await coachWithChatCompletions(trimmed, retrieved, profileNotes, predictedProfile, cfg, coachMode);
        if (Array.isArray(ai) && ai.length) {
          llmCards = ai;
          break;
        }
      } catch (e) {
        console.error(e);
      }
    }

    const typoCards = obviousSpellingGrammarHeuristics(trimmed);
    const dictCards = spellDictionarySuggestions(trimmed);
    let suggestions = dedupeSuggestionTitles([...typoCards, ...dictCards, ...(llmCards.length ? llmCards : []), ...heur]).slice(
      0,
      10,
    );

    const summary = `surface=${surface}; coachMode=${coachMode}; top retrieval: ${retrieved[0]?.chunk?.id || "none"}; words=${signals.wordCount}; longSentences=${signals.longSentenceCount}; commaSpliceSignals=${signals.commaSpliceSignals}`;
    const profileSnapshot = await appendProfile(userId, summary, signals).catch(() => predictedProfile);

    res.json({
      suggestions,
      profileSnapshot,
      retrievedChunks: retrieved.map((r) => ({
        id: r.chunk.id,
        score: r.score,
        text: r.chunk.text,
        source: r.chunk.source,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/documents", async (_req, res) => {
  try {
    const store = await readDocumentsStore();
    const list = (store.documents || []).map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updatedAt,
    }));
    list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    res.json({ documents: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/documents", async (req, res) => {
  try {
    const title =
      typeof req.body?.title === "string" && req.body.title.trim()
        ? req.body.title.trim().slice(0, 200)
        : "Untitled";
    const now = new Date().toISOString();
    const doc = {
      id: randomUUID(),
      title,
      content: "",
      createdAt: now,
      updatedAt: now,
    };
    const store = await readDocumentsStore();
    store.documents = Array.isArray(store.documents) ? store.documents : [];
    store.documents.push(doc);
    await writeDocumentsStore(store);
    res.status(201).json(doc);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/documents/:id", async (req, res) => {
  try {
    const store = await readDocumentsStore();
    const doc = (store.documents || []).find((d) => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/documents/:id", async (req, res) => {
  try {
    const store = await readDocumentsStore();
    const docs = Array.isArray(store.documents) ? store.documents : [];
    const idx = docs.findIndex((d) => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    const prev = docs[idx];
    const content =
      typeof req.body?.content === "string" ? req.body.content.slice(0, 200_000) : prev.content;
    let title = prev.title;
    if (typeof req.body?.title === "string") {
      const t = req.body.title.trim();
      if (t) title = t.slice(0, 200);
    }
    const next = {
      ...prev,
      title,
      content,
      updatedAt: new Date().toISOString(),
    };
    docs[idx] = next;
    store.documents = docs;
    await writeDocumentsStore(store);
    res.json(next);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

async function mountWebUi() {
  const indexPath = path.join(WEB_DIST, "index.html");
  try {
    await fs.access(indexPath);
  } catch {
    app.get("/", (_req, res) => {
      res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Write Up coach</title></head>
<body>
  <p>This is the <strong>Write Up</strong> coach API.</p>
  <ul>
    <li><a href="/health">GET /health</a> — status</li>
    <li>POST /coach — JSON body: <code>{"text":"...","userId":"..."}</code></li>
    <li>GET/POST <code>/api/documents</code> — documents for the web app</li>
  </ul>
  <p>Run <code>npm install && npm run build</code> in <code>prototypes/chris/web</code>, then reload this page for the React UI. For local dev, run the server and start Vite on port 5173.</p>
</body>
</html>`);
    });
    return;
  }
  app.use(express.static(WEB_DIST, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    if (req.path === "/health") return next();
    res.sendFile(indexPath, (err) => (err ? next(err) : undefined));
  });
}

await loadCorpus().catch((e) => {
  console.error("Failed to load corpus", e);
});

await mountWebUi();

app.listen(PORT, () => {
  console.log(`Write Up coach listening on http://localhost:${PORT}`);
});
