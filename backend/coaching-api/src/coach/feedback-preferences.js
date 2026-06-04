/**
 * Personalize coaching from persisted accept/decline history.
 * Declined issues are suppressed or deprioritized; accepted patterns are boosted.
 */

/** @param {string} issue */
export function normalizeIssueKey(issue) {
  return String(issue || "")
    .toLowerCase()
    .replace(/[\u201C\u201D"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} issue */
export function issueKindKey(issue) {
  const normalized = normalizeIssueKey(issue);
  const prefix = normalized.match(/^([a-z][a-z\s/-]{0,40}):/);
  return prefix ? prefix[1].trim() : "";
}

/** @param {object} suggestion */
export function suggestionCategory(suggestion) {
  return String(
    suggestion?.issueType || suggestion?.type || suggestion?.category || "coaching",
  ).toLowerCase();
}

/**
 * @param {{
 *   accepted?: { issue?: string, category?: string }[],
 *   declined?: { issue?: string, category?: string }[],
 *   categoryScores?: Record<string, { accepted?: number, declined?: number }>,
 * } | null | undefined} preferences
 */
export function buildPreferenceModel(preferences) {
  const declinedIssues = new Set();
  const acceptedIssues = new Set();
  const declinedKinds = new Set();
  const acceptedKinds = new Set();

  for (const row of preferences?.declined || []) {
    const key = normalizeIssueKey(row?.issue);
    if (key) declinedIssues.add(key);
    const kind = issueKindKey(row?.issue);
    if (kind) declinedKinds.add(kind);
  }
  for (const row of preferences?.accepted || []) {
    const key = normalizeIssueKey(row?.issue);
    if (key) acceptedIssues.add(key);
    const kind = issueKindKey(row?.issue);
    if (kind) acceptedKinds.add(kind);
  }

  return {
    declinedIssues,
    acceptedIssues,
    declinedKinds,
    acceptedKinds,
    categoryScores: preferences?.categoryScores || {},
  };
}

/**
 * @param {object} suggestion
 * @param {ReturnType<typeof buildPreferenceModel>} model
 */
export function shouldSuppressSuggestion(suggestion, model) {
  const titleKey = normalizeIssueKey(suggestion?.title);
  if (titleKey && model.declinedIssues.has(titleKey) && !model.acceptedIssues.has(titleKey)) {
    return true;
  }

  const kind = issueKindKey(suggestion?.title);
  if (
    kind &&
    model.declinedKinds.has(kind) &&
    !model.acceptedKinds.has(kind)
  ) {
    const cat = suggestionCategory(suggestion);
    const scores = model.categoryScores[cat] || { accepted: 0, declined: 0 };
    const declined = Number(scores.declined || 0);
    const accepted = Number(scores.accepted || 0);
    if (declined >= 2 && accepted === 0) return true;
  }

  return false;
}

/**
 * Higher score = show earlier / keep when trimming.
 * @param {object} suggestion
 * @param {ReturnType<typeof buildPreferenceModel>} model
 */
export function preferenceRankScore(suggestion, model) {
  let score = 0;
  const titleKey = normalizeIssueKey(suggestion?.title);
  const kind = issueKindKey(suggestion?.title);

  if (titleKey && model.acceptedIssues.has(titleKey)) score += 4;
  if (kind && model.acceptedKinds.has(kind)) score += 2;

  const cat = suggestionCategory(suggestion);
  const scores = model.categoryScores[cat] || { accepted: 0, declined: 0 };
  const accepted = Number(scores.accepted || 0);
  const declined = Number(scores.declined || 0);

  if (accepted >= 2) score += 2;
  else if (accepted > declined) score += 1;

  if (declined >= 2 && accepted === 0) score -= 3;
  else if (declined > accepted) score -= 1;

  if (titleKey && model.declinedIssues.has(titleKey)) score -= 5;
  if (kind && model.declinedKinds.has(kind)) score -= 1;

  return score;
}

/**
 * @param {unknown[]} suggestions
 * @param {ReturnType<typeof buildPreferenceModel>["categoryScores"] extends infer T ? object : never} preferences
 */
export function applyFeedbackPreferences(suggestions, preferences) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const hasHistory =
    (preferences?.accepted?.length || 0) > 0 ||
    (preferences?.declined?.length || 0) > 0 ||
    Object.keys(preferences?.categoryScores || {}).length > 0;
  if (!hasHistory) return list;

  const model = buildPreferenceModel(preferences);
  const filtered = list.filter((s) => !shouldSuppressSuggestion(s, model));
  return [...filtered].sort(
    (a, b) =>
      preferenceRankScore(b, model) - preferenceRankScore(a, model) ||
      (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

/**
 * Prompt lines for the LLM from accept/decline history.
 * @param {{ accepted?: { issue?: string }[], declined?: { issue?: string }[] } | null | undefined} preferences
 * @returns {string[]}
 */
export function feedbackPreferenceNotes(preferences) {
  const notes = [];
  for (const row of (preferences?.declined || []).slice(0, 8)) {
    const issue = String(row?.issue || "").trim();
    if (issue) notes.push(`User declined (avoid repeating): ${issue.slice(0, 180)}`);
  }
  for (const row of (preferences?.accepted || []).slice(0, 8)) {
    const issue = String(row?.issue || "").trim();
    if (issue) notes.push(`User accepted (similar coaching welcome): ${issue.slice(0, 180)}`);
  }
  return notes;
}
