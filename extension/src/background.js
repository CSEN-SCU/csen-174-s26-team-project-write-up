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

const ALLOWED_WEBAPP_ORIGINS = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "WRITEUP_OPEN_SIDE_PANEL") {
    return;
  }
  const wid = sender.tab?.windowId;
  if (wid == null) {
    sendResponse?.({ ok: false, reason: "no-window" });
    return;
  }
  chrome.sidePanel
    .open({ windowId: wid })
    .then(() => sendResponse?.({ ok: true }))
    .catch((err) => sendResponse?.({ ok: false, reason: String(err) }));
  return true;
});
