import { coachDebug } from "./coach-log.js";

/**
 * @param {string} label
 * @param {unknown} text
 */
export function logDetectorInput(label, text) {
  const t = String(text ?? "");
  coachDebug(`${label} INPUT`, t.slice(0, 200));
  coachDebug("TEXT TYPE", typeof text);
  coachDebug("TEXT LENGTH", t.length);
}

/**
 * @param {string} text
 */
export function logMechanicsTextProbe(text) {
  const t = String(text ?? "");
  coachDebug("mechanics text probe", {
    textLength: t.length,
    hasDefinately: t.includes("definately"),
    hasRecieved: t.includes("recieved"),
    hasCant: t.includes("cant"),
    hasTheirGoing: t.includes("Their going"),
    hasCompanyis: t.includes("companyis"),
  });
}

/**
 * @param {Record<string, number | string | boolean>} counts
 */
export function logMechanicsStageCounts(counts) {
  coachDebug("mechanics stages", counts);
}
