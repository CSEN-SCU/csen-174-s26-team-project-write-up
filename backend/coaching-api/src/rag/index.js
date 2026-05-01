import fs from "fs/promises";
import path from "path";
import nspell from "nspell";
import dictionaryEn from "dictionary-en";
import { KNOWLEDGE_DIR } from "../paths.js";
import { tokenize, buildTf } from "../lib/nlp.js";

/** @type {{ id: string, source: string, text: string }[]} */
let corpus = [];
/** @type {Map<string, { df: number, idf: number }>} */
let vocabStats = new Map();
/** @type {Map<string, Map<string, number>>} */
let tfByChunk = new Map();

/** Hunspell-backed checker; null if init fails. */
let spellchecker = null;

const SPELL_ALLOW = new Set(
  `omg lol lmao rofl imo tbh idk btw fr frfr ngl irl ig u ur bc cos cuz tho thru pls plz ppl ok okay yep nah huh hmm hm er um uh kinda sorta gonna wanna gotta hell damn darn shoot dang heck yeet sus cap fax nope haha hahaha woah whoa yall ya'll gonna cv api css html js ts jpg png gif pdf url uri sql dns tcp http https www com org net io co uk app apps ios android`
    .split(/\s+/),
);

try {
  spellchecker = nspell(dictionaryEn);
} catch (e) {
  console.warn("RAG spell augment: spellchecker unavailable:", e?.message || e);
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

export function retrieve(queryText, topK = 5) {
  const qTf = buildTf(tokenize(queryText));
  const qVec = tfidfVector(qTf);
  const scored = corpus.map((chunk) => {
    const cVec = tfidfVector(tfByChunk.get(chunk.id));
    return { chunk, score: cosine(qVec, cVec) };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, topK).filter((s) => s.score > 0);
}

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

/**
 * Multi-query TF–IDF: full draft, tail window, and spelling-augmented query.
 * @param {string} draftText
 * @param {number} [topK]
 */
export function retrieveForWritingCoach(draftText, topK = 8) {
  const trimmed = String(draftText).trim();
  const main = retrieve(trimmed, topK);
  const tail = trimmed.slice(-Math.min(520, trimmed.length));
  const tailHits =
    tail.length >= 100 && tail !== trimmed ? retrieve(tail, Math.min(6, topK)) : [];
  const aug = buildRagAugmentQuery(trimmed);
  const augHits = aug ? retrieve(`${trimmed.slice(0, 2400)}\n${aug}`, 6) : [];
  return mergeRetrievalResults([main, tailHits, augHits], topK);
}

export async function loadKnowledge() {
  const files = await fs.readdir(KNOWLEDGE_DIR).catch(() => []);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const chunks = [];
  let i = 0;
  for (const file of mdFiles) {
    const raw = await fs.readFile(path.join(KNOWLEDGE_DIR, file), "utf8");
    const parts = raw
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
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

  console.log(`RAG: loaded ${corpus.length} chunks from ${mdFiles.length} markdown file(s) in ${KNOWLEDGE_DIR}`);
}

export function getChunkCount() {
  return corpus.length;
}

export function hasSpellAugment() {
  return Boolean(spellchecker);
}
