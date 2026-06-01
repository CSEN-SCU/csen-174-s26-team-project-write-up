/**
 * Precision layer: ordered mechanics passes, confidence gate, span dedupe,
 * and punctuation on text after spelling/apostrophe/spacing fixes when material.
 */

import { dedupeSuggestionTitles } from "./format.js";
import { makeCard, CONFIDENCE_MIN } from "./issue-types.js";
import {
  obviousSpellingGrammarHeuristics,
  spellDictionarySuggestions,
  heuristicSuggestions,
  collectPunctuationMechanics,
} from "./heuristics.js";
import { prioritizeSuggestions } from "./prioritize-suggestions.js";

export { CONFIDENCE_MIN };

/** User-specified pass order for deterministic mechanics. */
const PASS_ORDER = [
  "spelling",
  "homophone",
  "apostrophe",
  "spacing",
  "capitalization",
  "punctuation",
  "grammar",
  "coherence",
  "repetition",
  "stretched_word",
  "style",
];

/**
 * @type {Array<{ pattern: RegExp, fix: string, confidence: number }>}
 */
export const NAMED_ENTITIES = [
  { pattern: /\bnew york\b/gi, fix: "New York", confidence: 0.97 },
  { pattern: /\bmicrosoft\b/gi, fix: "Microsoft", confidence: 0.97 },
  { pattern: /\bacme corporation\b/gi, fix: "Acme Corporation", confidence: 0.95 },
  { pattern: /\bsarah\b/gi, fix: "Sarah", confidence: 0.96 },
  { pattern: /\bchicago\b/gi, fix: "Chicago", confidence: 0.96 },
  { pattern: /\bparis\b/gi, fix: "Paris", confidence: 0.96 },
  { pattern: /\blondon\b/gi, fix: "London", confidence: 0.96 },
  { pattern: /\bcanada\b/gi, fix: "Canada", confidence: 0.96 },
  { pattern: /\bmichael\b/gi, fix: "Michael", confidence: 0.95 },
];

import { isSemanticallyUnusualButValid, whimsicalPassageMatchCount } from "./mechanics-detect.js";
import { coachDebug } from "./coach-log.js";
import { logDetectorInput, logMechanicsStageCounts, logMechanicsTextProbe } from "./mechanics-debug.js";

/**
 * @param {string} str
 */
function extractQuotedFromTitle(str) {
  const m = String(str || "").match(/[\u201C"]([^\u201D"]{1,120})[\u201D"]/);
  return m?.[1]?.trim() || null;
}

/**
 * @param {string} phrase
 * @param {string} content
 * @returns {{ start: number, end: number } | null}
 */
export function findSpanForPhrase(phrase, content) {
  const p = String(phrase || "").trim();
  if (!p || !content) return null;
  const idx = content.toLowerCase().indexOf(p.toLowerCase());
  if (idx !== -1) return { start: idx, end: idx + p.length };
  const parts = p.replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length > 1) {
    const esc = parts.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const m = new RegExp(esc.join("\\s+"), "i").exec(content);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  if (parts.length === 1 && /^\w+$/.test(parts[0])) {
    const esc = parts[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`\\b${esc}\\b`, "i").exec(content);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/**
 * @param {{ start: number, end: number }} a
 * @param {{ start: number, end: number }} b
 */
function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * @param {object} card
 * @param {string} content
 */
function attachSpan(card, content) {
  const phrase = extractQuotedFromTitle(card.title);
  if (!phrase) return { ...card, span: null };
  return { ...card, span: findSpanForPhrase(phrase, content) };
}

/**
 * @param {string} text
 */
export function detectNamedEntityCards(text) {
  coachDebug("RUNNING CAPITALIZATION ENTITY DETECTOR");
  logDetectorInput("CAPITALIZATION ENTITY", text);
  const t = String(text || "");
  const out = [];
  const covered = [];

  for (const ent of NAMED_ENTITIES) {
    for (const m of t.matchAll(ent.pattern)) {
      if (ent.confidence < CONFIDENCE_MIN) continue;
      const raw = m[0];
      const span = findSpanForPhrase(raw, t);
      if (!span) continue;
      if (covered.some((c) => spansOverlap(c, span))) continue;
      covered.push(span);
      out.push(
        makeCard(
          "capitalization",
          `Capitalization: \u201c${raw}\u201d`,
          `Use the standard form **${ent.fix}**.`,
          ent.fix,
          ent.confidence,
        ),
      );
    }
  }
  coachDebug("CAPITALIZATION ENTITY RESULTS", out.length);
  return out;
}

export { isSerialNounList } from "./mechanics-detect.js";

/**
 * @param {string} original
 * @param {string} corrected
 */
export function materialTextChange(original, corrected) {
  const a = String(original || "").replace(/\s+/g, " ").trim();
  const b = String(corrected || "").replace(/\s+/g, " ").trim();
  if (a === b) return false;
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return false;
  return (maxLen - minLen) / maxLen > 0.02 || a.toLowerCase() !== b.toLowerCase();
}

/**
 * Apply high-confidence spelling / apostrophe / spacing micro_edits for punctuation pass.
 * @param {string} text
 * @param {object[]} cards
 */
export function applyPrePunctuationCorrections(text, cards) {
  let out = String(text || "");
  const applicable = cards.filter(
    (c) =>
      (c.confidence ?? 1) >= CONFIDENCE_MIN &&
      c.micro_edit &&
      ["spelling", "apostrophe", "spacing", "homophone"].includes(c.issueType),
  );

  for (const c of applicable) {
    const phrase = extractQuotedFromTitle(c.title);
    if (!phrase) continue;
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "i");
    if (re.test(out)) {
      out = out.replace(re, c.micro_edit);
    }
  }
  return out;
}

/**
 * @param {object[]} cards
 * @param {number} [min]
 */
export function filterByConfidence(cards, min = CONFIDENCE_MIN) {
  return cards.filter((c) => (c.confidence ?? 0.9) >= min);
}

/**
 * One card per overlapping span; keep highest confidence.
 * @param {object[]} cards
 * @param {string} content
 */
export function dedupeOverlappingSpans(cards, content) {
  const withSpan = cards
    .map((c) => attachSpan(c, content))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  const kept = [];
  for (const card of withSpan) {
    if (!card.span) {
      kept.push(card);
      continue;
    }
    const overlaps = kept.some(
      (k) => k.span && spansOverlap(k.span, card.span),
    );
    if (!overlaps) kept.push(card);
  }
  return kept.map(({ span, ...rest }) => rest);
}

/**
 * Prefer one strong run-on card over weaker punctuation in the same stretch.
 * @param {object[]} cards
 */
export function suppressPunctuationNoiseNearRunOn(cards) {
  const runOns = cards.filter(
    (c) =>
      c.issueType === "punctuation" &&
      /run-on/i.test(c.title) &&
      (c.confidence ?? 0) >= 0.88,
  );
  if (!runOns.length) return cards;

  const runSpans = runOns
    .map((c) => c.span)
    .filter(Boolean);
  if (!runSpans.length) return cards;

  return cards.filter((c) => {
    if (c.issueType !== "punctuation" || /run-on/i.test(c.title)) return true;
    if ((c.confidence ?? 0) >= 0.9) return true;
    if (!c.span) return true;
    const insideRunOn = runSpans.some((r) => spansOverlap(r, c.span));
    return !insideRunOn;
  });
}

/**
 * Drop capitalization cards subsumed by a named-entity correction.
 * @param {object[]} cards
 * @param {string} content
 */
function dropRedundantCapitalization(cards, content) {
  const entityCards = cards.filter(
    (c) => c.issueType === "capitalization" && /Capitalization:/i.test(c.title),
  );
  const entitySpans = entityCards
    .map((c) => attachSpan(c, content).span)
    .filter(Boolean);

  return cards.filter((c) => {
    if (c.issueType !== "capitalization" || !entitySpans.length) return true;
    const span = attachSpan(c, content).span;
    if (!span) return true;
    const subsumed = entitySpans.some(
      (e) => e.start <= span.start && e.end >= span.end && (e.end - e.start) > (span.end - span.start),
    );
    return !subsumed;
  });
}

/**
 * @param {object[]} cards
 * @param {string} issueType
 */
function findingsByIssueType(cards, issueType) {
  return cards.filter((c) => c.issueType === issueType);
}

/**
 * @param {object[]} cards
 */
function sortByPassOrder(cards) {
  const order = new Map(PASS_ORDER.map((t, i) => [t, i]));
  return [...cards].sort(
    (a, b) =>
      (order.get(a.issueType) ?? 50) - (order.get(b.issueType) ?? 50) ||
      (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

/**
 * @param {string} text
 * @param {"typing"|"paused"} coachMode
 */
export function collectPunctuationOnly(text) {
  return collectPunctuationMechanics(text);
}

/**
 * Full precision-aware mechanics assembly (no LLM).
 * @param {string} text
 * @param {"typing"|"paused"} coachMode
 */
export function assembleMechanicsSuggestions(text, coachMode = "paused") {
  const original = String(text || "");
  logMechanicsTextProbe(original);

  if (!original.trim()) {
    logMechanicsStageCounts({ gate: "empty", finalMechanics: 0 });
    return [];
  }
  const whimsicalMatches = whimsicalPassageMatchCount(original);
  const skipWhimsical = isSemanticallyUnusualButValid(original);
  if (skipWhimsical) {
    logMechanicsStageCounts({ gate: "whimsical", whimsicalMatches, finalMechanics: 0 });
    return [];
  }

  const dictMax = coachMode === "paused" ? 40 : 12;
  logDetectorInput("SPELLING", original);
  const spellDict = spellDictionarySuggestions(original, { maxCards: dictMax });
  logDetectorInput("OBVIOUS HEURISTICS", original);
  const obvious = obviousSpellingGrammarHeuristics(original);
  const entities = detectNamedEntityCards(original);

  const spellingFindings = [
    ...findingsByIssueType(spellDict, "spelling"),
    ...findingsByIssueType(spellDict, "homophone"),
    ...findingsByIssueType(obvious, "spelling"),
    ...findingsByIssueType(obvious, "homophone"),
    ...findingsByIssueType(obvious, "grammar"),
  ];
  const apostropheFindings = [
    ...findingsByIssueType(spellDict, "apostrophe"),
    ...findingsByIssueType(obvious, "apostrophe"),
  ];
  const capitalizationFindings = [
    ...entities,
    ...findingsByIssueType(obvious, "capitalization"),
  ];
  const spacingFindings = [
    ...findingsByIssueType(spellDict, "spacing"),
    ...findingsByIssueType(obvious, "spacing"),
    ...findingsByIssueType(obvious, "repetition"),
    ...findingsByIssueType(obvious, "stretched_word"),
  ];

  logMechanicsStageCounts({
    spelling: spellingFindings.length,
    apostrophe: apostropheFindings.length,
    capitalization: capitalizationFindings.length,
    spacing: spacingFindings.length,
  });

  let cards = [...spellDict, ...obvious, ...entities];

  cards = filterByConfidence(cards);
  cards = dedupeOverlappingSpans(cards, original);
  cards = dropRedundantCapitalization(cards, original);

  const prePunctTypes = new Set(["spelling", "apostrophe", "spacing", "homophone"]);
  const corrected = applyPrePunctuationCorrections(
    original,
    cards.filter((c) => prePunctTypes.has(c.issueType)),
  );

  let punctText = original;
  if (materialTextChange(original, corrected)) {
    punctText = corrected;
  }

  const styleAndCoherence = heuristicSuggestions(original, coachMode, {
    includePunctuation: false,
  })
    .map((c) => ({
      ...c,
      issueType:
        c.issueType ||
        (c.type === "voice" || c.type === "pattern" ? "style" : c.type === "coherence" ? "coherence" : "style"),
      confidence: c.confidence ?? 0.85,
    }))
    .filter((c) => ["style", "coherence"].includes(c.issueType));

  logDetectorInput("PUNCTUATION", punctText);
  let punctuationFindings = collectPunctuationOnly(punctText);
  coachDebug("PUNCTUATION", punctuationFindings.length);

  let punctuation = filterByConfidence(punctuationFindings);

  cards = [...cards, ...punctuation, ...filterByConfidence(styleAndCoherence)];
  cards = dedupeOverlappingSpans(cards, original);
  cards = attachSpanToAll(cards, original);
  cards = suppressPunctuationNoiseNearRunOn(cards);
  cards = filterByConfidence(cards);
  cards = sortByPassOrder(cards);

  const mechanics = cards
    .map(({ span, ...rest }) => rest)
    .filter((c) => (c.confidence ?? 0) >= CONFIDENCE_MIN);

  logMechanicsStageCounts({
    punctuation: punctuationFindings.length,
    finalMechanics: mechanics.length,
  });

  return mechanics;
}

/**
 * @param {object[]} cards
 * @param {string} content
 */
function attachSpanToAll(cards, content) {
  return cards.map((c) => {
    const { span } = attachSpan(c, content);
    return span ? { ...c, span } : c;
  });
}

/**
 * @param {string} text
 * @param {"typing"|"paused"} coachMode
 * @param {number} max
 */
export function finalizeMechanicsSuggestions(text, coachMode, max) {
  const raw = assembleMechanicsSuggestions(text, coachMode);
  const mechanics = prioritizeSuggestions(dedupeSuggestionTitles(raw), max);
  coachDebug("FINAL MECHANICS (after cap)", mechanics.length);
  return mechanics;
}
