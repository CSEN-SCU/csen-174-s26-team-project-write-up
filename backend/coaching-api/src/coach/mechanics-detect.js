/** Shared detection helpers (no imports from heuristics/pipeline). */

const VERB_LIKE = new Set(
  "is are was were am be been being have has had do does did go went come came get got make made take took see saw know knew think thought say said want need like love hate run ran walk walked talk talked watch watched read write wrote work worked live lived play played help helped look looked feel felt seem seemed become became leave left keep kept start started stop stopped end ended begin began grow grew turn turned move moved open opened close closed use used try tried".split(
    " ",
  ),
);

const COORDINATOR = new Set("and or but nor yet so for".split(" "));

/**
 * True for "apples oranges bananas and grapes" — not "went home and watched".
 * @param {string} segment
 */
export function isSerialNounList(segment) {
  const m = String(segment).match(
    /\b([a-z]{3,})\s+([a-z]{3,})\s+([a-z]{3,})\s+and\s+([a-z]{3,})\b/i,
  );
  if (!m || /,/.test(segment)) return false;
  const words = [m[1], m[2], m[3], m[4]].map((w) => w.toLowerCase());
  if (words.some((w) => COORDINATOR.has(w) || VERB_LIKE.has(w))) return false;
  return true;
}

const WHIMSICAL_PASSAGE =
  /\b(?:purple|invisible|silent|angry|happy)\s+\w+\s+(?:negotiate|whisper|calculate|debate|sing|dance)\b/gi;

/**
 * True only for short, intentionally absurd passages — not long drafts that
 * happen to contain "happy … negotiate" in passing.
 * @param {string} text
 */
export function isSemanticallyUnusualButValid(text) {
  const t = String(text || "");
  if (!WHIMSICAL_PASSAGE.test(t)) return false;
  WHIMSICAL_PASSAGE.lastIndex = 0;
  // Long real drafts: always run spelling/grammar detectors.
  if (t.length > 600) return false;
  return true;
}

/**
 * @param {string} text
 */
export function whimsicalPassageMatchCount(text) {
  const t = String(text || "");
  return [...t.matchAll(WHIMSICAL_PASSAGE)].length;
}
