/**
 * Default coach personalization sent with every request until onboarding UI exists.
 * App-api overwrites userId from auth; coaching-api still reads these fields for the LLM.
 */
(function (root) {
  root.writeUpDefaultCoachPersonalization = Object.freeze({
    goals: "",
    audience: "",
    tonePreference: "neutral",
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
