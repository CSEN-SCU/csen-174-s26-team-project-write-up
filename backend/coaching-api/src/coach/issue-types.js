/**
 * Canonical mechanics issue types for suggestion cards.
 * Used for UI filtering, RAG gating, and regression tests.
 */

/** Minimum confidence to surface a suggestion (precision over recall). */
export const CONFIDENCE_MIN = 0.8;

export const ISSUE_TYPES = [
  "spelling",
  "capitalization",
  "punctuation",
  "apostrophe",
  "homophone",
  "spacing",
  "repetition",
  "stretched_word",
  "style",
  "coherence",
  "grammar",
];

/** @typedef {typeof ISSUE_TYPES[number]} IssueType */

/**
 * Legacy `type` field still used by guardrails / extension clients.
 * @param {IssueType} issueType
 */
export function legacyTypeFor(issueType) {
  switch (issueType) {
    case "punctuation":
      return "punctuation";
    case "coherence":
      return "coherence";
    case "style":
      return "voice";
    case "repetition":
    case "stretched_word":
      return "clarity";
    default:
      return "grammar";
  }
}

/**
 * @param {IssueType} issueType
 * @param {string} title
 * @param {string} body
 * @param {string | null} [micro_edit]
 */
export function makeCard(issueType, title, body, micro_edit = null, confidence = 0.9) {
  return {
    issueType,
    type: legacyTypeFor(issueType),
    title,
    body,
    micro_edit,
    confidence,
  };
}
