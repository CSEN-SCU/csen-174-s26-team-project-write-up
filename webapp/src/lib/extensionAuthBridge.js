import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

/**
 * When the user is signed in on the webapp, push a fresh Firebase ID token to the
 * Chrome extension (externally_connectable) so the side panel can call app-api
 * with Authorization: Bearer …
 */
export function initExtensionAuthSync() {
  const extId = import.meta.env.VITE_EXTENSION_ID;
  if (!extId || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      chrome.runtime.sendMessage(extId, { type: "WRITEUP_SET_ID_TOKEN", token }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      /* ignore */
    }
  });
}
