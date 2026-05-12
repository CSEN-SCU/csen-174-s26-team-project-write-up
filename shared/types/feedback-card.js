/**
 * Coaching wire format vs persisted feedback history.
 *
 * **Coach output** (`POST /coach` JSON): each row is a {@link CoachSuggestionCard}.
 * **History** (`POST /feedback-history`): Firestore-shaped {@link FeedbackCard}-like payload
 * (see `extension/src/sidepanel/persist-feedback.js` mapping from coach cards).
 *
 * Allowed coach `type` strings after guardrails: `pattern`, `coherence`, `clarity`, `grammar`, `punctuation`, `voice`.
 */

/** @typedef {"pattern"|"coherence"|"clarity"|"grammar"|"punctuation"|"voice"} CoachSuggestionType */

/**
 * One card in `suggestions` and `cards` on a successful `POST /coach` response (same array twice).
 * Heuristics and the LLM emit this shape; `applyRagFeedbackGuardrails` drops unknown types,
 * malformed rows, and suggestions whose quoted evidence does not appear in the user draft.
 *
 * @typedef {Object} CoachSuggestionCard
 * @property {CoachSuggestionType} type
 * @property {string} title — short headline (may include markdown emphasis)
 * @property {string} body — reader-focused explanation
 * @property {string|null|undefined} [micro_edit] — optional single-clause wording hint; omit or null when none
 */

/**
 * @typedef {Object} RetrievedChunk
 * @property {string} id
 * @property {number} score
 * @property {string} text
 * @property {string} source
 */

/**
 * Successful `POST /coach` JSON body (HTTP 200) from coaching-api / app-api proxy.
 * @typedef {Object} CoachApiSuccessBody
 * @property {CoachSuggestionCard[]} suggestions
 * @property {CoachSuggestionCard[]} cards — duplicate of `suggestions` for clients that expect `cards`
 * @property {string} feedback — plain-text rendering of cards for simple UIs (`suggestionsToFeedback`)
 * @property {string} source — e.g. `"coaching-api"`
 * @property {string|null} [model] — LLM id when the model ran; null if heuristics-only
 * @property {string} userId
 * @property {{ goals: string, audience: string, tonePreference: "formal"|"neutral"|"casual" }} personalization
 * @property {object|null} profileSnapshot — aggregate writing signals (see `summarizeProfile`)
 * @property {RetrievedChunk[]} retrievedChunks
 * @property {number} vocabulary_pairs_saved
 */

/** @typedef {"grammar"|"clarity"|"vocabulary"|"tone"|"pattern"} FeedbackCategory */

/** @typedef {{start:number,end:number}} TextSpan */

/**
 * Persisted / UI card shape (Firestore `feedback_history` and related APIs).
 * `issue` / `why` align with coach `title` / `body` when mapped from {@link CoachSuggestionCard}.
 *
 * @typedef {Object} FeedbackCard
 * @property {string} id
 * @property {FeedbackCategory} category
 * @property {TextSpan} [span] — optional when not anchored to a text range
 * @property {string} issue
 * @property {string} why
 * @property {string[]} fixOptions
 * @property {string[]} sources
 * @property {number} confidence
 */
export {};
