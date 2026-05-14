/**
 * Shared app-api request headers: prefer Firebase ID token from storage (set by
 * webapp via externally_connectable); fall back to X-Debug-User on localhost.
 * Local debug uses a persisted stable uid so coaching-api personalization and
 * per-user draft retrieval stay tied to this install.
 */
(function (root) {
  const STORAGE_DEBUG_UID = "writeUpLocalDebugUserId";
  const LEGACY_DEBUG_UID = "local-extension-user";

  root.writeUpApiBaseForDebug = "";

  function randomUid() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return `ext-${crypto.randomUUID()}`;
    } catch (_) {
      /* ignore */
    }
    return `ext-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  root.writeUpBuildApiHeaders = function () {
    return new Promise((resolve) => {
      const base = String(root.writeUpApiBaseForDebug || "");
      const isLocal = /127\.0\.0\.1|localhost/i.test(base);

      const fallback = () => {
        const h = { "Content-Type": "application/json" };
        if (isLocal) h["X-Debug-User"] = LEGACY_DEBUG_UID;
        resolve(h);
      };

      if (!chrome?.storage?.local) {
        fallback();
        return;
      }

      try {
        chrome.storage.local.get({ firebaseIdToken: "", [STORAGE_DEBUG_UID]: "" }, (s) => {
          try {
            if (chrome.runtime.lastError) {
              fallback();
              return;
            }
            const h = { "Content-Type": "application/json" };
            if (s.firebaseIdToken) {
              h.Authorization = `Bearer ${s.firebaseIdToken}`;
              resolve(h);
              return;
            }
            if (!isLocal) {
              resolve(h);
              return;
            }
            let uid = String(s[STORAGE_DEBUG_UID] || "").trim();
            if (uid) {
              h["X-Debug-User"] = uid;
              resolve(h);
              return;
            }
            uid = randomUid();
            try {
              chrome.storage.local.set({ [STORAGE_DEBUG_UID]: uid }, () => {
                if (chrome.runtime.lastError) {
                  h["X-Debug-User"] = LEGACY_DEBUG_UID;
                  resolve(h);
                  return;
                }
                h["X-Debug-User"] = uid;
                resolve(h);
              });
            } catch (_) {
              h["X-Debug-User"] = LEGACY_DEBUG_UID;
              resolve(h);
            }
          } catch (_) {
            fallback();
          }
        });
      } catch (_) {
        fallback();
      }
    });
  };

  root.writeUpClearAuthToken = function () {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.remove(["firebaseIdToken"], () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
