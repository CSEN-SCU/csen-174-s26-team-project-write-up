/**
 * Keeps high-value mechanics cards when the merged list exceeds the UI cap.
 * Priority: homophone/apostrophe/spelling/punctuation/spacing before repetition/stretched.
 */

/** Matches mechanics pass order: spelling → apostrophe → spacing → capitalization → punctuation → style. */
const PRIORITY = {
  spelling: 1,
  apostrophe: 2,
  homophone: 3,
  spacing: 4,
  capitalization: 5,
  punctuation: 6,
  grammar: 7,
  coherence: 8,
  style: 9,
  repetition: 10,
  stretched_word: 11,
};

/**
 * @param {unknown[]} suggestions
 * @param {number} max
 */
export function prioritizeSuggestions(suggestions, max) {
  const list = Array.isArray(suggestions) ? [...suggestions] : [];
  const n = Math.max(0, Math.floor(Number(max) || 0));
  if (!n || list.length <= n) return list;

  const score = (s) => PRIORITY[String(s?.issueType || "").toLowerCase()] ?? 7;

  return [...list]
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        (b.confidence ?? 0) - (a.confidence ?? 0),
    )
    .slice(0, n);
}
