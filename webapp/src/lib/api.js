/**
 * Thin wrapper around fetch() that:
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

  let res;
  try {
    res = await fetch(path, init);
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

  history: (docId) =>
    apiFetch(`/api/feedback-history?docId=${encodeURIComponent(docId ?? "")}`, {
      fallback: { items: [], degraded: true, error: "offline" },
    }),

  /**
   * Proxied by app-api to coaching-api. Pass `Authorization: Bearer <idToken>` in
   * headers when signed in. For local bypass, set VITE_DEBUG_APP_USER in `.env`
   * to match app-api APP_AUTH_BYPASS (see root `.env.example`).
   */
  coach: (text, userId, { headers: extraHeaders = {} } = {}) => {
    const debugUser = import.meta.env.VITE_DEBUG_APP_USER;
    const bypass =
      typeof debugUser === "string" && debugUser.trim()
        ? { "X-Debug-User": debugUser.trim() }
        : {};
    return apiFetch("/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bypass, ...extraHeaders },
      body: JSON.stringify({ text, userId, surface: "web" }),
    });
  },

  saveFeedback: (record) =>
    apiFetch("/api/feedback-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }),
};
