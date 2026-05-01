/**
 * Opt-in LLM request/response logging (stderr). Never logs API keys from env;
 * redacts common secret patterns in error bodies.
 */

const TRUTHY = new Set(["1", "true", "yes", "y", "on", "debug", "verbose"]);

export function coachLogLlmEnabled() {
  const v = String(process.env.COACH_LOG_LLM || "").toLowerCase().trim();
  return TRUTHY.has(v);
}

export function coachLogLlmFullBodies() {
  const v = String(process.env.COACH_LOG_LLM_FULL || "").toLowerCase().trim();
  return TRUTHY.has(v);
}

export function coachLogLlmPreviewLimit() {
  const n = Number(process.env.COACH_LOG_LLM_PREVIEW || 400);
  if (!Number.isFinite(n) || n < 80) return 400;
  return Math.min(Math.floor(n), 8000);
}

/** @param {string} s */
export function redactSecrets(s) {
  return String(s)
    .replace(/\bgsk_[A-Za-z0-9]+\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [REDACTED]");
}

/**
 * @param {string} s
 * @param {number} maxTotal max characters (approx; uses head + tail)
 */
export function previewText(s, maxTotal) {
  const t = String(s);
  if (coachLogLlmFullBodies()) return t;
  if (t.length <= maxTotal) return t;
  const head = Math.max(40, Math.floor(maxTotal / 2) - 3);
  const tail = Math.max(40, maxTotal - head - 3);
  return `${t.slice(0, head)}…[${t.length - head - tail} chars omitted]…${t.slice(-tail)}`;
}

/** @param {Record<string, unknown>} obj */
export function coachLlmLog(event, obj) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...obj });
  console.error(`[coach-llm] ${line}`);
}
