/**
 * Filters LLM/RAG-backed suggestions so obvious bad outputs do not reach the writer.
 * Pure functions — easy to unit test without HTTP or models.
 */

const ALLOWED_TYPES = new Set(["pattern", "coherence", "clarity", "grammar", "punctuation", "voice"]);

/** @param {string} s */
function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'");
}

/**
 * Pulls double-quoted spans (ASCII or curly) from a string; ignores very short noise.
 * @param {string} str
 * @param {number} [minLen]
 * @returns {string[]}
 */
export function extractQuotedPhrases(str, minLen = 3) {
  const t = String(str || "");
  const out = [];
  for (const m of t.matchAll(/"([^"]+)"/g)) {
    const inner = m[1].trim();
    if (inner.length >= minLen) out.push(inner);
  }
  for (const m of t.matchAll(/\u201c([^\u201d]+)\u201d/g)) {
    const inner = m[1].trim();
    if (inner.length >= minLen) out.push(inner);
  }
  return out;
}

/**
 * Drops cards with no usable title and no usable body (empty noise from the model).
 * @param {unknown[]} suggestions
 */
export function dropMalformedSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((s) => {
    const title = String(s?.title ?? "").trim();
    const body = String(s?.body ?? "").trim();
    return title.length > 0 || body.length > 0;
  });
}

/**
 * When the model puts words in quotes, those words should appear in my draft — otherwise it may be inventing issues.
 * If there are no quoted spans, the suggestion is kept (titles like "Possible comma splice" are allowed).
 * @param {unknown[]} suggestions
 * @param {string} userText
 */
export function filterQuotedEvidenceInUserText(suggestions, userText) {
  if (!Array.isArray(suggestions)) return [];
  const hay = normalizeForMatch(userText);
  return suggestions.filter((s) => {
    const blob = `${String(s?.title ?? "")} ${String(s?.body ?? "")}`;
    const phrases = extractQuotedPhrases(blob, 3);
    if (phrases.length === 0) return true;
    return phrases.every((p) => hay.includes(normalizeForMatch(p)));
  });
}

/**
 * Only coaching categories we render in the product — odd types from JSON drift are dropped.
 * @param {unknown[]} suggestions
 */
export function allowOnlyKnownSuggestionTypes(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((s) => ALLOWED_TYPES.has(String(s?.type ?? "").toLowerCase()));
}

/**
 * Caps how many cards I see in one pass so the side panel is not flooded after a bad model burst.
 * @param {unknown[]} suggestions
 * @param {number} max
 */
export function enforceSuggestionLimit(suggestions, max) {
  if (!Array.isArray(suggestions)) return [];
  const n = Math.max(0, Math.floor(Number(max) || 0));
  return suggestions.slice(0, n);
}

/**
 * @param {unknown[]} suggestions
 * @param {{ userText: string, max?: number }} ctx
 */
export function applyRagFeedbackGuardrails(suggestions, ctx) {
  const userText = String(ctx?.userText ?? "");
  const max = ctx?.max ?? 10;
  let out = Array.isArray(suggestions) ? [...suggestions] : [];
  out = dropMalformedSuggestions(out);
  out = allowOnlyKnownSuggestionTypes(out);
  out = filterQuotedEvidenceInUserText(out, userText);
  out = enforceSuggestionLimit(out, max);
  return out;
}
