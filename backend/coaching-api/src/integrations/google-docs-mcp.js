/**
 * Resolve draft text when the extension sends use_mcp + doc_id (Google Docs live mode).
 * Supports either:
 *   - Direct Google Docs API v1 with GOOGLE_DOCS_ACCESS_TOKEN (documents.readonly), or
 *   - HTTP JSON bridge via GOOGLE_DOCS_MCP_BRIDGE_URL (same contract as prototypes/ishika server).
 */

/** @param {unknown} v */
function asBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  return false;
}

/**
 * @param {unknown} payload
 * @returns {string}
 */
export function extractTextFromMcpPayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload.trim();
  if (typeof payload === "object" && !Array.isArray(payload)) {
    const o = /** @type {Record<string, unknown>} */ (payload);
    for (const key of ["documentText", "text", "output_text", "output", "content"]) {
      const val = o[key];
      if (typeof val === "string" && val.trim()) return val.trim();
    }
    for (const nested of ["result", "data", "response"]) {
      const got = extractTextFromMcpPayload(o[nested]);
      if (got) return got;
    }
  }
  if (Array.isArray(payload)) {
    const parts = [];
    for (const item of payload) {
      const txt = extractTextFromMcpPayload(item);
      if (txt) parts.push(txt);
    }
    return parts.join("\n").trim();
  }
  return "";
}

/**
 * @param {unknown} docPayload
 * @returns {string}
 */
export function documentJsonToPlainText(docPayload) {
  const body = docPayload && typeof docPayload === "object" ? /** @type {any} */ (docPayload).body : null;
  const content = body && typeof body === "object" ? body.content : null;
  if (!Array.isArray(content)) return "";
  const chunks = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const para = /** @type {any} */ (block).paragraph;
    if (!para || typeof para !== "object") continue;
    const elements = para.elements;
    if (!Array.isArray(elements)) continue;
    for (const el of elements) {
      if (!el || typeof el !== "object") continue;
      const tr = /** @type {any} */ (el).textRun;
      if (tr && typeof tr.content === "string") chunks.push(tr.content);
    }
  }
  return chunks.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * @param {string} docId
 * @returns {Promise<string>}
 */
async function fetchViaGoogleDocsApi(docId) {
  const token = (process.env.GOOGLE_DOCS_ACCESS_TOKEN || "").trim();
  if (!token) {
    throw new Error(
      "GOOGLE_DOCS_ACCESS_TOKEN is not set. Use an OAuth access token with https://www.googleapis.com/auth/documents.readonly.",
    );
  }
  const enc = encodeURIComponent(docId);
  const url = `https://docs.googleapis.com/v1/documents/${enc}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Google Docs API HTTP ${res.status}: ${raw.slice(0, 280)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Google Docs API returned invalid JSON.");
  }
  const plain = documentJsonToPlainText(data);
  if (!plain) {
    throw new Error("Google Docs API returned an empty document body.");
  }
  return plain;
}

/**
 * @param {string} docId
 * @returns {Promise<string>}
 */
async function fetchViaHttpMcpBridge(docId) {
  const bridgeUrl = (process.env.GOOGLE_DOCS_MCP_BRIDGE_URL || "").trim();
  const tool = (process.env.GOOGLE_DOCS_MCP_TOOL || "google_docs.get_document_text").trim();
  const bearer = (process.env.GOOGLE_DOCS_MCP_AUTH_BEARER || "").trim();

  const payload = {
    name: tool,
    arguments: { document_id: docId, doc_id: docId },
  };
  const headers = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(bridgeUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`MCP bridge HTTP ${res.status}: ${raw.slice(0, 240)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("MCP bridge returned non-JSON.");
  }
  const text = extractTextFromMcpPayload(data);
  if (!text) {
    throw new Error("MCP bridge response did not include document text.");
  }
  return text;
}

/**
 * @param {string} docId
 * @returns {Promise<string>}
 */
export async function fetchDocumentPlainText(docId) {
  const bridge = (process.env.GOOGLE_DOCS_MCP_BRIDGE_URL || "").trim();
  if (bridge) {
    return fetchViaHttpMcpBridge(docId);
  }
  return fetchViaGoogleDocsApi(docId);
}

/**
 * Resolve draft text: if the client sends `use_mcp: true` but this server has no Docs API token
 * or MCP bridge, treat as normal DOM `text` (extension checkbox does not imply server support).
 * When MCP *is* configured and `use_mcp` is true, load from Google Docs API or bridge using `doc_id`.
 * @param {object} body
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string, status: number }>}
 */
export async function resolveCoachDraftText(body) {
  const useMcpRequested = asBool(body?.use_mcp);
  const docId = String(body?.doc_id || body?.docId || "").trim();
  const rawText = typeof body?.text === "string" ? body.text : "";

  const bridge = (process.env.GOOGLE_DOCS_MCP_BRIDGE_URL || "").trim();
  const token = (process.env.GOOGLE_DOCS_ACCESS_TOKEN || "").trim();
  const mcpConfigured = Boolean(bridge || token);
  const useMcp = useMcpRequested && mcpConfigured;

  if (!useMcp) {
    return { ok: true, text: rawText };
  }
  if (!docId) {
    return { ok: false, error: 'When use_mcp is true, provide doc_id (or docId).', status: 400 };
  }
  try {
    const text = await fetchDocumentPlainText(docId);
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 502 };
  }
}
