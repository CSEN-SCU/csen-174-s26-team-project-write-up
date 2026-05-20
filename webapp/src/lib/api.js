/**
 * Thin wrapper around fetch() that:
 *   - attaches Firebase Bearer (or VITE_DEBUG_APP_USER) on every request,
 *   - parses JSON safely (HTML 502 pages don't crash the UI),
 *   - raises a typed ApiError on non-2xx so React components can branch on it,
 *   - optionally returns a fallback value for safe GET reads when the server
 *     is unreachable, so the app stays usable in degraded mode.
 *
 * Writes (POST/PUT/PATCH/DELETE) never fall back silently - those failures
 * must surface so the user knows their action did not persist.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = "unknown_error", data = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** Absolute app-api base (no trailing slash). Unset in local dev → Vite proxy uses same-origin relative paths. */
const APP_API_BASE =
  typeof import.meta.env.VITE_APP_API_BASE_URL === "string"
    ? import.meta.env.VITE_APP_API_BASE_URL.trim().replace(/\/+$/, "")
    : "";

function resolveApiUrl(path) {
  if (!path.startsWith("/") || !APP_API_BASE) {
    return path;
  }
  return `${APP_API_BASE}${path}`;
}

/** @type {null | (() => Promise<string | null>)} */
let getIdTokenCallback = null;

export function setWebappIdTokenGetter(fn) {
  getIdTokenCallback = typeof fn === "function" ? fn : null;
}

export function clearWebappIdTokenGetter() {
  getIdTokenCallback = null;
}

async function mergeAuthHeaders(initHeaders = {}) {
  if (getIdTokenCallback) {
    try {
      const token = await getIdTokenCallback();
      if (token && typeof token === "string" && token.trim()) {
        return { ...initHeaders, Authorization: `Bearer ${token.trim()}` };
      }
    } catch {
      /* fall through to debug user */
    }
  }
  const debugUser = import.meta.env.VITE_DEBUG_APP_USER;
  const out = { ...initHeaders };
  if (typeof debugUser === "string" && debugUser.trim()) {
    out["X-Debug-User"] = debugUser.trim();
  }
  return out;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiFetch(path, options = {}) {
  const { fallback, ...init } = options;
  const method = (init.method || "GET").toUpperCase();
  const isSafe = SAFE_METHODS.has(method);

  init.headers = await mergeAuthHeaders(init.headers || {});

  let res;
  try {
    res = await fetch(resolveApiUrl(path), init);
  } catch (networkErr) {
    if (isSafe && fallback !== undefined) return fallback;
    throw new ApiError("network_error", { status: 0, code: "network_error" });
  }

  const body = await parseBody(res);

  if (!res.ok) {
    const code = (body && body.error) || `http_${res.status}`;
    if (isSafe && fallback !== undefined && res.status >= 500) return fallback;
    throw new ApiError(code, { status: res.status, code, data: body });
  }

  return body;
}

export const api = {
  me: () => apiFetch("/api/users/me", { fallback: null }),

  history: (docId, { headers: extraHeaders = {} } = {}) =>
    apiFetch(`/api/feedback-history?docId=${encodeURIComponent(docId ?? "")}`, {
      headers: extraHeaders,
      fallback: { items: [], degraded: true, error: "offline" },
    }),

  /**
   * Proxied by app-api → coaching-api (Chris / swe-test-style live coach).
   * userId is set server-side from the Firebase token; do not send a client uid.
   */
  coach: (text, { coachMode = "paused", surface = "web", headers: extraHeaders = {} } = {}) =>
    apiFetch("/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify({
        text,
        surface,
        coachMode: coachMode === "typing" ? "typing" : "paused",
      }),
    }),

  documents: {
    list: ({ headers: extraHeaders = {} } = {}) =>
      apiFetch("/api/documents", {
        headers: extraHeaders,
        fallback: { documents: [], degraded: true, error: "offline" },
      }),

    get: (id, { headers: extraHeaders = {} } = {}) =>
      apiFetch(`/api/documents/${encodeURIComponent(id)}`, { headers: extraHeaders }),

    create: (title = "Untitled", { headers: extraHeaders = {} } = {}) =>
      apiFetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify({ title }),
      }),

    update: (id, { title, content }, { headers: extraHeaders = {} } = {}) =>
      apiFetch(`/api/documents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify({ title, content }),
      }),
  },

  saveFeedback: (record, { headers: extraHeaders = {} } = {}) =>
    apiFetch("/api/feedback-history", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(record),
    }),

  submitOnboarding: (payload) =>
    apiFetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  postDismissal: (payload) =>
    apiFetch("/api/dismissals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
