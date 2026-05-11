/**
 * End-to-end feedback loop: persist coaching suggestions to app-api Firestore.
 * Loaded before sidepanel.js; exposes global writeUpPersistCoachSuggestions.
 */
(function (root) {
  function mapCategory(type) {
    const x = String(type || "").toLowerCase();
    const m = {
      grammar: "grammar",
      punctuation: "grammar",
      clarity: "clarity",
      coherence: "clarity",
      vocabulary: "vocabulary",
      tone: "tone",
      voice: "tone",
      pattern: "pattern",
    };
    return m[x] || "pattern";
  }

  /**
   * @param {string} appBase
   * @param {Record<string, string>} headers
   * @param {string} docId
   * @param {object} coachJson
   * @returns {Promise<{ saved: number, total: number }>}
   */
  async function persistCoachSuggestions(appBase, headers, docId, coachJson) {
    let hdrs = headers;
    if (!hdrs && typeof root.writeUpBuildApiHeaders === "function") {
      root.writeUpApiBaseForDebug = appBase;
      hdrs = await root.writeUpBuildApiHeaders();
    }
    if (!hdrs) hdrs = { "Content-Type": "application/json" };

    const base = String(appBase || "").replace(/\/$/, "");
    const list = Array.isArray(coachJson?.suggestions)
      ? coachJson.suggestions
      : Array.isArray(coachJson?.cards)
        ? coachJson.cards
        : [];
    if (!list.length || !docId) return { saved: 0, total: 0 };

    const runKey = Date.now();
    let saved = 0;
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i] || {};
      const title = String(s.title || "Suggestion").trim();
      const body = String(s.body || "").trim();
      const micro = s.micro_edit != null ? String(s.micro_edit).trim() : "";
      const cardId = `coach-${runKey}-${i}`;
      const sources = Array.isArray(coachJson?.retrievedChunks)
        ? coachJson.retrievedChunks
            .slice(0, 5)
            .map((c) => c && c.id)
            .filter(Boolean)
        : [];

      const payload = {
        docId,
        cardId,
        category: mapCategory(s.type),
        issue: title,
        why: body,
        fixOptions: micro ? [micro] : [],
        sources,
        confidence: 0.85,
      };

      const res = await fetch(`${base}/feedback-history`, {
        method: "POST",
        headers: { ...hdrs, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) saved += 1;
    }
    return { saved, total: list.length };
  }

  root.writeUpPersistCoachSuggestions = persistCoachSuggestions;
})(typeof globalThis !== "undefined" ? globalThis : window);
