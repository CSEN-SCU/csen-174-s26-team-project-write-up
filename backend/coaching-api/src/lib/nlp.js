export const HEDGE_WORDS = ["like", "basically", "literally", "honestly", "actually", "kind", "sort"];

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function buildTf(tokens) {
  const tf = new Map();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  const max = Math.max(...tf.values(), 1);
  for (const [k, v] of tf) {
    tf.set(k, v / max);
  }
  return tf;
}

export function countMatches(text, regex) {
  const m = String(text || "").match(regex);
  return m ? m.length : 0;
}
