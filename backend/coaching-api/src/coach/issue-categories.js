/**
 * Deterministic mechanics vs RAG-backed coaching categories.
 * Grammar/spelling/punctuation findings must never depend on retrieval.
 */

/** @typedef {string} IssueType */

export const DETERMINISTIC_ISSUE_TYPES = new Set([
  "grammar",
  "spelling",
  "capitalization",
  "apostrophe",
  "spacing",
  "repetition",
  "punctuation",
  "homophone",
  "stretched_word",
]);

/** RAG + LLM coaching only — not spelling/punctuation mechanics. */
export const RAG_COACHING_ISSUE_TYPES = new Set([
  "coherence",
  "clarity",
  "tone",
  "style",
  "organization",
  "audience",
]);

/**
 * @param {{ issueType?: string, type?: string, title?: string }} card
 * @returns {string}
 */
export function resolveIssueType(card) {
  const explicit = String(card?.issueType || "").toLowerCase();
  if (explicit) return explicit;

  const title = String(card?.title || "");
  if (/^Spelling:|^Unrecognized word:|^Typo:/i.test(title)) return "spelling";
  if (/^Capitalization:/i.test(title)) return "capitalization";
  if (/^Missing apostrophe:|^[Aa]postrophe/i.test(title)) return "apostrophe";
  if (/^Missing space:|^Possible split:|^Compound word:|^Extra spaces/i.test(title)) return "spacing";
  if (/^Repeated word:/i.test(title)) return "repetition";
  if (/^Stretched word:/i.test(title)) return "stretched_word";
  if (/^Homophone:|^Word confusion:/i.test(title)) return "homophone";
  if (/^Grammar:/i.test(title)) return "grammar";
  if (
    /comma splice|semicolon|colon before|Missing punctuation|run-on|question mark|Missing commas in list|introductory clause/i.test(
      title,
    )
  ) {
    return "punctuation";
  }
  if (/Tone shift|informal|profane|register/i.test(title)) return "style";
  if (/Contradictory|Very long sentence/i.test(title)) return "coherence";
  if (/hedge|filler/i.test(title)) return "clarity";

  const legacy = String(card?.type || "").toLowerCase();
  if (legacy === "voice") return "style";
  if (legacy === "pattern") return "organization";
  if (legacy === "punctuation") return "punctuation";
  if (legacy === "coherence") return "coherence";
  if (legacy === "clarity") return "clarity";
  return legacy || "grammar";
}

/**
 * @param {{ issueType?: string, type?: string, title?: string }} card
 */
export function isDeterministicCard(card) {
  return DETERMINISTIC_ISSUE_TYPES.has(resolveIssueType(card));
}

/**
 * @param {{ issueType?: string, type?: string, title?: string }} card
 */
export function isCoachingCard(card) {
  return RAG_COACHING_ISSUE_TYPES.has(resolveIssueType(card));
}

/**
 * Strip LLM outputs that duplicate deterministic detectors.
 * @param {unknown[]} suggestions
 */
export function filterToCoachingOnly(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .filter((s) => isCoachingCard(s))
    .map((s) => ({
      ...s,
      issueType: resolveIssueType(s),
    }));
}
