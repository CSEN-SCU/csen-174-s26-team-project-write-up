export function dedupeSuggestionTitles(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const s of items) {
    const key = String(s?.title || "").trim().toLowerCase();
    if (!key) {
      out.push(s);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Plain-text feedback for extension clients that expect a `feedback` string. */
export function suggestionsToFeedback(suggestions) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (!list.length) {
    return "No suggestions on this pass—try a slightly longer excerpt, or your draft reads clean for spelling and quick clarity checks.";
  }
  return list
    .map((s, i) => {
      const title = String(s?.title || "Note").trim();
      const body = String(s?.body || "").trim();
      const me = s?.micro_edit != null && String(s.micro_edit).trim() !== "" ? `\nTry: ${s.micro_edit}` : "";
      return `${i + 1}. ${title}\n${body}${me}`;
    })
    .join("\n\n");
}
