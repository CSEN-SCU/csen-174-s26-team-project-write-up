/**
 * Weak words are identified by the LLM only (writing-level rubric in groq.js).
 * This module keeps helpers for merging AI output with character offsets.
 */

/**
 * @deprecated Always empty — kept so callers can pass writingLevel unchanged.
 * @returns {[]}
 */
export function findWeakWordSpans(_text, _writingLevel) {
  return [];
}

/**
 * @param {string} text
 * @param {string} term
 * @returns {{ start: number, end: number } | null}
 */
export function firstOccurrence(text, term) {
  if (!text || !term) return null;
  const idx = text.indexOf(term);
  if (idx === -1) return null;
  return { start: idx, end: idx + term.length };
}
