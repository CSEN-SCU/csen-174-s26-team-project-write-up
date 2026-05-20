/**
 * Heuristics to skip dictionary spell-check on keyboard mash / random tokens.
 */

/** @param {string} raw */
export function isLikelyGibberishToken(raw) {
  const w = String(raw || "").toLowerCase();
  if (w.length < 4) return false;
  if (/[0-9\[\]{}_@#|\\/-]/.test(w)) return true;
  const vowels = (w.match(/[aeiouy]/gi) || []).length;
  if (vowels / w.length < 0.12 && w.length >= 5) return true;
  if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(w)) return true;
  if (/(.)\1{3,}/.test(w)) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {{ total: number, meaningful: number }}
 */
export function countMeaningfulTokens(text) {
  const tokens = String(text || "").match(/\b[a-zA-Z]{3,}\b/g) || [];
  let meaningful = 0;
  for (const t of tokens) {
    if (!isLikelyGibberishToken(t)) meaningful += 1;
  }
  return { total: tokens.length, meaningful };
}

/** True when most alphabetic tokens look like random typing, not prose. */
export function draftLooksLikeKeyboardMash(text) {
  const { total, meaningful } = countMeaningfulTokens(text);
  if (total < 4) return false;
  return meaningful / total < 0.4;
}
