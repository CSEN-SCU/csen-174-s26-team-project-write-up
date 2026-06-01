/**
 * Coaching API logging — no draft text in production logs.
 *
 * COACH_LOG=1           — one JSON summary line per coach pass (counts only)
 * COACH_DEBUG_MECHANICS=1 — verbose detector traces (local debugging only)
 */

function envFlag(name) {
  const v = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isCoachLogEnabled() {
  return envFlag("COACH_LOG");
}

export function isCoachDebugMechanicsEnabled() {
  return envFlag("COACH_DEBUG_MECHANICS");
}

/**
 * @param {string} msg
 * @param {...unknown} args
 */
export function coachDebug(msg, ...args) {
  if (!isCoachDebugMechanicsEnabled()) return;
  console.log(`[coach-debug] ${msg}`, ...args);
}

/**
 * Structured, PII-safe coach pass summary.
 * @param {Record<string, unknown>} fields
 */
export function coachLogSummary(fields) {
  if (!isCoachLogEnabled()) return;
  console.log(JSON.stringify({ tag: "coach-pass", ...fields }));
}
