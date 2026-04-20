/**
 * Open the Write Up side panel when the user clicks the extension icon (Grammarly-style entry).
 * Also opens the panel when the landing page navigates to #try (via content script message).
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
