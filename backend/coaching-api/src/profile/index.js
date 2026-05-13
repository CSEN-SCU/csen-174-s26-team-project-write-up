import fs from "fs/promises";
import { DATA_DIR, PROFILE_PATH } from "../paths.js";
import { tokenize, HEDGE_WORDS, countMatches } from "../lib/nlp.js";

export function createEmptyProfile() {
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

export function analyzeWritingSignals(text) {
  const trimmed = String(text || "").trim();
  const sentenceParts = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentences = sentenceParts.length ? sentenceParts : trimmed ? [trimmed] : [];
  const words = tokenize(trimmed);
  const wordCount = words.length;

  const sentenceWordCounts = sentences.map((s) => tokenize(s).length).filter((n) => n > 0);
  const longSentenceCount = sentenceWordCounts.filter((n) => n >= 30).length;

  const commaSpliceSignals = countMatches(
    trimmed,
    /\b[^.!?\n]{6,},\s+[a-z]+\s+(?:i|you|we|they|he|she|it)\b/gi,
  );
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

export function mergeProfile(profile, signals) {
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

/** Lightweight index for per-user draft corpus (full text stays server-side). */
export function summarizeDraftsIndex(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  return list.map((d) => ({
    id: String(d?.id || ""),
    createdAt: d?.createdAt || null,
    charCount: String(d?.text || "").length,
    source: String(d?.source || "user-draft-history"),
  }));
}

export function summarizeProfile(profile) {
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

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readProfileStore() {
  try {
    const raw = await fs.readFile(PROFILE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function appendProfile(userId, summary, signals) {
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

/**
 * Keep a small rolling draft history per user for retrieval personalization.
 * @param {string} userId
 * @param {string} text
 */
export async function appendUserDraft(userId, text) {
  await ensureDataDir();
  const store = await readProfileStore();
  const prev = store[userId] || { notes: [], profile: createEmptyProfile(), updatedAt: null };
  const drafts = Array.isArray(prev.drafts) ? prev.drafts : [];
  const trimmed = String(text || "").trim().slice(0, 12000);
  if (!trimmed) return;

  drafts.push({
    id: `user-draft:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    source: "user-draft-history",
    text: trimmed,
    createdAt: new Date().toISOString(),
  });

  if (drafts.length > 25) {
    prev.drafts = drafts.slice(drafts.length - 25);
  } else {
    prev.drafts = drafts;
  }

  prev.updatedAt = new Date().toISOString();
  store[userId] = prev;
  await fs.writeFile(PROFILE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/** @param {string} userId @param {object} event */
export async function applyDismiss(userId, event) {
  await ensureDataDir();
  const store = await readProfileStore();
  const prev = store[userId] || { notes: [], profile: createEmptyProfile(), updatedAt: null };
  prev.notes = Array.isArray(prev.notes) ? prev.notes : [];
  const title = event?.title ? String(event.title).slice(0, 200) : "item";
  prev.notes.push({
    at: new Date().toISOString(),
    summary: `dismissed suggestion: ${title}`,
  });
  if (prev.notes.length > 40) {
    prev.notes = prev.notes.slice(prev.notes.length - 40);
  }
  prev.updatedAt = new Date().toISOString();
  store[userId] = prev;
  await fs.writeFile(PROFILE_PATH, JSON.stringify(store, null, 2), "utf8");
  return summarizeProfile(prev.profile);
}
