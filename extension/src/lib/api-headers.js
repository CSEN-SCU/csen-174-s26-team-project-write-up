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
              // Local app-api: always send X-Debug-User too so APP_AUTH_BYPASS can win over a stale token.
              if (isLocal) {
                const dbg = String(s[STORAGE_DEBUG_UID] || "").trim();
                h["X-Debug-User"] = dbg || LEGACY_DEBUG_UID;
              }
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

  /**
   * Google Docs (https) → app-api (http://127.0.0.1:5050):
   * Try direct `fetch` first — matches prototypes/ishika/extension + architecture in
   * https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/commit/1011aca122d2d9bf6ac9cf996e5627c2236ce94b
   * (content script → Flask on loopback with host_permissions). If that fails, fall back to the
   * service worker proxy (mixed content / PNA quirks on some Chrome builds).
   * Side panel (chrome-extension://) always uses direct fetch.
   */
  root.writeUpFetchAppApi = function (url, options) {
    options = options || {};
    var method = String(options.method || "GET").toUpperCase();
    var headers = options.headers || {};
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      var flat = {};
      headers.forEach(function (v, k) {
        flat[k] = v;
      });
      headers = flat;
    }
    var body = options.body;
    var uStr = String(url);
    var isAppApi5050 = false;
    try {
      var pu = new URL(uStr);
      isAppApi5050 =
        pu.protocol === "http:" &&
        ["127.0.0.1", "localhost"].indexOf(pu.hostname) !== -1 &&
        pu.port === "5050";
    } catch (_) {
      isAppApi5050 = false;
    }
    var tryDirectThenProxyFromDocs =
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function" &&
      typeof location !== "undefined" &&
      isAppApi5050 &&
      location.protocol === "https:" &&
      location.hostname === "docs.google.com";

    if (!tryDirectThenProxyFromDocs) {
      return fetch(url, options);
    }

    function synthetic(resp) {
      return {
        status: resp.status,
        ok: resp.status >= 200 && resp.status < 300,
        json: function () {
          try {
            return Promise.resolve(JSON.parse(resp.bodyText || "{}"));
          } catch (e) {
            return Promise.reject(e);
          }
        },
        text: function () {
          return Promise.resolve(resp.bodyText || "");
        },
      };
    }

    function proxyViaServiceWorker() {
      var msg = {
        type: "WRITEUP_PROXY_FETCH",
        url: String(url),
        method: method,
        headers: headers,
        body: body == null ? undefined : String(body),
      };
      return new Promise(function (resolve, reject) {
        function finish(resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!resp || !resp.ok) {
            var detail =
              resp && resp.error
                ? String(resp.error)
                : "Could not reach app-api through the extension background.";
            reject(new Error(detail));
            return;
          }
          resolve(synthetic(resp));
        }
        try {
          var maybePromise = chrome.runtime.sendMessage(msg);
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise
              .then(function (resp) {
                if (!resp || !resp.ok) {
                  reject(
                    new Error(
                      (resp && resp.error) || "Could not reach app-api through the extension background.",
                    ),
                  );
                  return;
                }
                resolve(synthetic(resp));
              })
              .catch(function (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
              });
            return;
          }
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        chrome.runtime.sendMessage(msg, finish);
      });
    }

    return fetch(url, options).catch(function () {
      return proxyViaServiceWorker();
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
