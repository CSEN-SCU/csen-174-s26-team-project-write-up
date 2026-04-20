/**
 * When the Write Up landing page navigates to #try, ask the background worker
 * to open the side panel (Chrome may still require a prior user gesture in some cases).
 */
const MESSAGE = { type: "WRITEUP_OPEN_SIDE_PANEL" };
let lastOpen = 0;

function openPanelIfTryHash() {
  if (location.hash !== "#try") return;
  const now = Date.now();
  if (now - lastOpen < 800) return;
  lastOpen = now;
  try {
    chrome.runtime.sendMessage(MESSAGE, () => void chrome.runtime.lastError);
  } catch (_) {
    /* not running as extension */
  }
}

window.addEventListener("hashchange", openPanelIfTryHash);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", openPanelIfTryHash);
} else {
  openPanelIfTryHash();
}
