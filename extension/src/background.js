/**
 * Open the Write Up side panel when the user clicks the extension icon (Grammarly-style entry).
 * Also opens the panel when the landing page navigates to #try (via content script message).
 * Accepts Firebase ID tokens from the webapp (externally_connectable) for authenticated API calls.
 */
function openSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(openSidePanelOnActionClick);
chrome.runtime.onStartup.addListener(openSidePanelOnActionClick);
openSidePanelOnActionClick();

const ALLOWED_WEBAPP_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://csen-174-s26-team-project-write-up.vercel.app",
]);

function senderAllowed(sender) {
  const url = sender?.url || "";
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`;
    return ALLOWED_WEBAPP_ORIGINS.has(origin);
  } catch {
    return false;
  }
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!senderAllowed(sender)) {
    sendResponse?.({ ok: false, error: "forbidden_origin" });
    return false;
  }
  if (msg?.type === "WRITEUP_SET_ID_TOKEN" && typeof msg.token === "string" && msg.token.length > 50) {
    chrome.storage.local.set({ firebaseIdToken: msg.token }, () => {
      sendResponse?.({ ok: true });
    });
    return true;
  }
  sendResponse?.({ ok: false, error: "unknown_message" });
  return false;
});

/** Only these app-api paths may be requested via background proxy (no arbitrary URLs). */
const _ALLOWED_APP_API_PATHS = new Set(["/", "/health", "/coach", "/feedback-history", "/dismiss"]);

function normalizedAppPathname(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  let p = (u.pathname || "/").replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

function isAllowedAppApiUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }
  if (u.protocol !== "http:") return false;
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) return false;
  if (u.port !== "5050") return false;
  const path = normalizedAppPathname(urlStr);
  return path != null && _ALLOWED_APP_API_PATHS.has(path);
}

/** Some Windows / Chrome setups resolve loopback differently; try the other host on failure. */
function alternateLoopbackUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.hostname === "127.0.0.1") {
      u.hostname = "localhost";
      return u.href;
    }
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
      return u.href;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fetchAppApiWithLoopbackFallback(urlStr, init) {
  return fetch(urlStr, init).catch((err) => {
    if (err && err.name === "AbortError") throw err;
    const alt = alternateLoopbackUrl(urlStr);
    if (!alt) throw err;
    return fetch(alt, init);
  });
}

let _canFetchTargetLocal;
function canFetchTargetLocal() {
  if (_canFetchTargetLocal !== undefined) return _canFetchTargetLocal;
  try {
    new Request("http://127.0.0.1:5050/", { targetAddressSpace: "local" });
    _canFetchTargetLocal = true;
  } catch {
    _canFetchTargetLocal = false;
  }
  return _canFetchTargetLocal;
}

const PROXY_FETCH_TIMEOUT_MS = 130000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WRITEUP_PROXY_FETCH") {
    const { url, method, headers, body } = message;
    const m = String(method || "GET").toUpperCase();
    if (!isAllowedAppApiUrl(url) || !["GET", "POST", "HEAD", "OPTIONS"].includes(m)) {
      sendResponse?.({ ok: false, error: "bad_target" });
      return false;
    }
    const init = {
      method: m,
      headers: { ...(headers && typeof headers === "object" ? headers : {}) },
      cache: "no-store",
    };
    if (body != null && m !== "GET" && m !== "HEAD") init.body = body;
    if (canFetchTargetLocal()) {
      init.targetAddressSpace = "local";
    }
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), PROXY_FETCH_TIMEOUT_MS);
    init.signal = ac.signal;
    console.info("[write-up] app-api proxy", m, url);
    fetchAppApiWithLoopbackFallback(url, init)
      .then(async (res) => {
        clearTimeout(tid);
        const bodyText = await res.text();
        console.info("[write-up] app-api proxy done", res.status, url);
        sendResponse?.({ ok: true, status: res.status, bodyText });
      })
      .catch((err) => {
        clearTimeout(tid);
        const name = err && err.name;
        const msg = err?.message ? String(err.message) : String(err);
        console.warn("[write-up] app-api proxy fail", url, name, msg);
        if (name === "AbortError") {
          sendResponse?.({
            ok: false,
            error: `Timed out after ${PROXY_FETCH_TIMEOUT_MS / 1000}s waiting for app-api (coach/LLM can be slow).`,
          });
        } else {
          sendResponse?.({ ok: false, error: msg });
        }
      });
    return true;
  }

  if (message?.type !== "WRITEUP_OPEN_SIDE_PANEL") {
    return false;
  }
  const wid = sender.tab?.windowId;
  if (wid == null) {
    sendResponse?.({ ok: false, reason: "no-window" });
    return false;
  }
  chrome.sidePanel
    .open({ windowId: wid })
    .then(() => sendResponse?.({ ok: true }))
    .catch((err) => sendResponse?.({ ok: false, reason: String(err) }));
  return true;
});
