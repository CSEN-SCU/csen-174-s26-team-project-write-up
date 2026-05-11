/**
 * Shared app-api request headers: prefer Firebase ID token from storage (set by
 * webapp via externally_connectable); fall back to X-Debug-User on localhost.
 */
(function (root) {
  const DEBUG_UID = "local-extension-user";

  root.writeUpApiBaseForDebug = "";

  root.writeUpBuildApiHeaders = function () {
    return new Promise((resolve) => {
      const base = String(root.writeUpApiBaseForDebug || "");
      const isLocal = /127\.0\.0\.1|localhost/i.test(base);

      if (!chrome?.storage?.local) {
        const h = { "Content-Type": "application/json" };
        if (isLocal) h["X-Debug-User"] = DEBUG_UID;
        resolve(h);
        return;
      }

      chrome.storage.local.get({ firebaseIdToken: "" }, (s) => {
        const h = { "Content-Type": "application/json" };
        if (s.firebaseIdToken) {
          h.Authorization = `Bearer ${s.firebaseIdToken}`;
          resolve(h);
          return;
        }
        if (isLocal) h["X-Debug-User"] = DEBUG_UID;
        resolve(h);
      });
    });
  };

  root.writeUpClearAuthToken = function () {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.remove(["firebaseIdToken"], resolve);
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
