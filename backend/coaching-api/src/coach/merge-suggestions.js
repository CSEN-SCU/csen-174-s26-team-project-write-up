import { dedupeSuggestionTitles } from "./format.js";
import {
  dropMalformedSuggestions,
  allowOnlyKnownSuggestionTypes,
  filterQuotedEvidenceInUserText,
} from "./guardrails.js";
import { prioritizeSuggestions } from "./prioritize-suggestions.js";

/**
 * Light guardrails for rule-based cards — never dropped when RAG returns nothing.
 * @param {unknown[]} suggestions
 * @param {{ userText: string }} ctx
 */
export function applyDeterministicGuardrails(suggestions, ctx) {
  const userText = String(ctx?.userText ?? "");
  let out = Array.isArray(suggestions) ? [...suggestions] : [];
  out = dropMalformedSuggestions(out);
  out = allowOnlyKnownSuggestionTypes(out);
  // Rule-based cards already anchor to real spans; quoted-evidence filter is for LLM output.
  return out;
}

/**
 * Guardrails for LLM/RAG coaching cards only.
 * @param {unknown[]} suggestions
 * @param {{ userText: string, max?: number }} ctx
 */
export function applyCoachingGuardrails(suggestions, ctx) {
  const userText = String(ctx?.userText ?? "");
  const max = ctx?.max ?? 10;
  let out = Array.isArray(suggestions) ? [...suggestions] : [];
  out = dropMalformedSuggestions(out);
  out = allowOnlyKnownSuggestionTypes(out);
  out = filterQuotedEvidenceInUserText(out, userText);
  if (max > 0 && out.length > max) {
    out = prioritizeSuggestions(out, max);
  }
  return out;
}

/**
 * Merge deterministic findings with coaching findings.
 * Mechanics use detMax; coaching uses coachMax; optional totalMax applies priority trim.
 *
 * @param {unknown[]} deterministic
 * @param {unknown[]} coaching
 * @param {{
 *   userText?: string,
 *   detMax?: number,
 *   coachMax?: number,
 *   totalMax?: number,
 * }} [opts]
 */
export function mergeDeterministicAndCoaching(deterministic, coaching, opts = {}) {
  const userText = String(opts.userText ?? "");
  const detMax = Math.max(0, Math.floor(Number(opts.detMax) || 80));
  const coachMax = Math.max(0, Math.floor(Number(opts.coachMax) || 30));
  const totalMax = Math.max(0, Math.floor(Number(opts.totalMax) || 0));

  let det = dedupeSuggestionTitles(deterministic);
  if (detMax > 0 && det.length > detMax) {
    det = prioritizeSuggestions(det, detMax);
  }
  det = applyDeterministicGuardrails(det, { userText });

  const coach = applyCoachingGuardrails(dedupeSuggestionTitles(coaching), {
    userText,
    max: coachMax,
  });

  let merged = dedupeSuggestionTitles([...det, ...coach]);
  if (totalMax > 0 && merged.length > totalMax) {
    merged = prioritizeSuggestions(merged, totalMax);
  }
  return merged;
}
