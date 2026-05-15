// TODO(EXT-3): add inline highlight rendering from returned card spans.
/**
 * Experimental Google Docs live capture.
 * Supports direct DOM text mode and MCP bridge mode (doc_id only).
 */
(function () {
  if (!/\/document\/d\//.test(location.pathname || "")) return;

  const APP_API_BASE = "http://127.0.0.1:5050";
  globalThis.writeUpApiBaseForDebug = APP_API_BASE;

  /** Google Docs often renders the canvas in a child frame; `all_frames` + this avoids toolbars/ads. */
  function editorMountNode() {
    return (
      document.getElementById("docs-editor") ||
      document.querySelector(".kix-appview-editor") ||
      document.querySelector(".docs-text-ui")
    );
  }

  async function coachHeaders() {
    if (typeof globalThis.writeUpBuildApiHeaders === "function") {
      return globalThis.writeUpBuildApiHeaders();
    }
    const h = { "Content-Type": "application/json" };
    if (/127\.0\.0\.1|localhost/i.test(APP_API_BASE)) {
      h["X-Debug-User"] = "local-extension-user";
    }
    return h;
  }

  /** Turn app-api JSON errors into text for the Docs live status line. */
  function liveCoachErrorMessage(data, httpStatus) {
    const code = data && data.error;
    if (code === "missing_token") {
      return (
        "Auth: add APP_ENV=dev and APP_AUTH_BYPASS=1 to app-api .env, restart npm run dev:app, " +
        "or use Sign in (web) in the side panel for a Firebase token."
      );
    }
    if (code === "missing_debug_user") {
      return (
        "Auth bypass is on but X-Debug-User was missing. Reload the extension (stale Firebase token can block bypass), " +
        "or send X-Debug-User from the client."
      );
    }
    if (code === "coaching_upstream" || code === "coaching_timeout" || code === "coaching_bad_response") {
      return "App-api could not reach coaching-api. Run `npm run dev:coach` from the repo root (same machine as app-api).";
    }
    if (typeof data?.error === "string" && /Empty text after trim/i.test(data.error)) {
      return (
        "Live: no draft text reached the coach (empty doc in the extension view, or DOM capture missed your text). " +
        "Scroll the document, type a line, turn off 'Fetch text via Docs API / MCP' if you are not using server MCP, or paste into the side panel."
      );
    }
    if (typeof data?.error === "string" && data.error.includes("GOOGLE_DOCS")) {
      return "MCP mode: set GOOGLE_DOCS_ACCESS_TOKEN or GOOGLE_DOCS_MCP_BRIDGE_URL for coaching-api, or turn off 'Fetch text via Docs API / MCP' in the side panel.";
    }
    return (data && (data.message || data.error)) || `HTTP ${httpStatus}`;
  }

  const DEBOUNCE_MS = 2800;
  const MIN_CHARS = 72;
  const MIN_FETCH_GAP_MS = 3500;
  const POLL_EVERY_MS = 4000;
  const MAX_CHARS = 9000;
  const COACH_LIVE_TIMEOUT_MS = 125000;

  function coachLiveFetchWithDeadline(url, options) {
    let tid;
    const timeoutP = new Promise((_, reject) => {
      tid = setTimeout(() => {
        reject(
          new Error(
            `Docs live: timed out after ${COACH_LIVE_TIMEOUT_MS / 1000}s waiting for /coach (LLM or app-api).`,
          ),
        );
      }, COACH_LIVE_TIMEOUT_MS);
    });
    return Promise.race([
      appFetch(url, options).finally(() => {
        if (tid) clearTimeout(tid);
      }),
      timeoutP,
    ]);
  }

  let observer = null;
  let pollTimer = null;
  let debounceTimer = null;
  let lastDigest = "";
  let lastFetchAt = 0;
  let inFlight = false;

  function hasStorage() {
    return !!(typeof chrome !== "undefined" && chrome.storage && chrome.storage.local);
  }

  function updateLiveState(patch) {
    if (!hasStorage()) return;
    chrome.storage.local.set(patch);
  }

  function getDocIdFromUrl() {
    const m = String(location.pathname || "").match(/\/document\/d\/([^/]+)/);
    return m ? m[1] : "";
  }

  function extractDocsText() {
    const editorRoot =
      document.getElementById("docs-editor") ||
      document.querySelector(".kix-appview-editor") ||
      document.querySelector(".docs-text-ui") ||
      document.querySelector('[role="main"]') ||
      document.body;

    function linesFrom(nodes) {
      const lines = [];
      nodes.forEach((el) => {
        const text = (el.textContent || "").replace(/\u00a0/g, " ").trim();
        if (text) lines.push(text);
      });
      return lines;
    }

    // Primary: per-line blocks (classic Docs canvas).
    let lineBlocks = editorRoot.querySelectorAll(".kix-lineview-text-block");
    let lines = linesFrom(lineBlocks);
    if (!lines.length) {
      lineBlocks = editorRoot.querySelectorAll(".kix-lineview");
      lines = linesFrom(lineBlocks);
    }
    if (!lines.length) {
      lineBlocks = editorRoot.querySelectorAll('[data-thread-id] .kix-lineview-text-block');
      lines = linesFrom(lineBlocks);
    }

    let text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

    // Fallback: bounded innerText from the page canvas (avoids most chrome UI).
    if (!text) {
      const page =
        document.querySelector(".kix-page-paginated") ||
        document.querySelector(".kix-page") ||
        document.querySelector(".kix-canvas-tile-content");
      const scope = page || editorRoot;
      const raw = (scope.innerText || scope.textContent || "").replace(/\u00a0/g, " ");
      text = raw.replace(/\n{3,}/g, "\n\n").trim();
    }

    // Last resort: main contenteditable region (may include some noise; still bounded).
    if (!text) {
      const ce = document.querySelector('.docs-text-ui[contenteditable="true"]');
      if (ce) {
        text = (ce.innerText || ce.textContent || "").replace(/\u00a0/g, " ").trim();
      }
    }

    return text.slice(0, MAX_CHARS);
  }

  function digestOf(text, useMcp, docId) {
    if (useMcp) return `mcp:${docId}`;
    const compact = text.replace(/\s+/g, " ").trim();
    return `${compact.length}:${compact.slice(0, 220)}`;
  }

  function withLiveConfig(cb) {
    if (!hasStorage()) {
      cb({
        docsLiveEnabled: false,
        docsLiveUseMcp: false,
        docsLiveFocus: ["vocabulary", "tone"],
      });
      return;
    }
    chrome.storage.local.get(
      {
        docsLiveEnabled: false,
        docsLiveUseMcp: false,
        docsLiveFocus: ["vocabulary", "tone"],
      },
      (cfg) => cb(cfg)
    );
  }

  const appFetch = typeof globalThis.writeUpFetchAppApi === "function" ? globalThis.writeUpFetchAppApi : fetch.bind(globalThis);

  async function callFeedback(payload) {
    const headers = await coachHeaders();
    const res = await coachLiveFetchWithDeadline(`${APP_API_BASE}/coach`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(liveCoachErrorMessage(data, res.status));
    return data;
  }

  function schedule() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  }

  function flush() {
    debounceTimer = null;
    withLiveConfig((cfg) => {
      if (!cfg.docsLiveEnabled || inFlight) return;
      const docId = getDocIdFromUrl();
      if (!docId) return;

      const useMcp = !!cfg.docsLiveUseMcp;
      const domText = extractDocsText();
      if (!domText.trim()) {
        updateLiveState({
          liveDocsStatus: useMcp
            ? "Live: no on-page text. Without GOOGLE_DOCS_MCP_BRIDGE_URL or GOOGLE_DOCS_ACCESS_TOKEN on coaching-api, turn off 'Fetch text via Docs API / MCP'—otherwise the coach still gets an empty body. With MCP env set, the server loads the doc by id (this frame may be empty)."
            : "Live: no text in this frame yet. Click the doc body, scroll, or wait for load. If this persists, reload Write Up on chrome://extensions (we inject into editor frames).",
        });
        return;
      }
      if (!useMcp && domText.length < MIN_CHARS) {
        updateLiveState({ liveDocsStatus: "Draft too short for live snapshot." });
        return;
      }

      const digest = digestOf(useMcp ? "" : domText, useMcp, docId);
      // In MCP mode the content comes from the bridge, so don't freeze on a static doc_id digest.
      if (!useMcp && digest === lastDigest) return;

      const now = Date.now();
      if (now - lastFetchAt < MIN_FETCH_GAP_MS) {
        schedule();
        return;
      }
      lastFetchAt = now;
      lastDigest = digest;
      inFlight = true;
      updateLiveState({
        liveDocsStatus: "Calling coach…",
        liveDocsDocId: docId,
      });

      const personalization =
        globalThis.writeUpDefaultCoachPersonalization &&
        typeof globalThis.writeUpDefaultCoachPersonalization === "object"
          ? { ...globalThis.writeUpDefaultCoachPersonalization }
          : { goals: "", audience: "", tonePreference: "neutral" };
      callFeedback({
        text: domText,
        focus: Array.isArray(cfg.docsLiveFocus) ? cfg.docsLiveFocus : ["vocabulary", "tone"],
        surface: "extension-docs-live",
        ...personalization,
        live: true,
        use_mcp: useMcp,
        doc_id: docId,
      })
        .then(async (data) => {
          if (typeof writeUpPersistCoachSuggestions === "function" && docId) {
            try {
              await writeUpPersistCoachSuggestions(APP_API_BASE, null, docId, data);
            } catch (_) {
              /* non-fatal: live feedback still shown */
            }
          }
          updateLiveState({
            liveDocsStatus: `Updated (${data.source || "text"})`,
            liveDocsFeedback: data.feedback || "",
            liveDocsUpdatedAt: Date.now(),
          });
        })
        .catch((err) => {
          lastDigest = "";
          const m = err && err.message ? String(err.message) : "";
          let hint = m || "Live request failed. Check server and MCP bridge config.";
          if (m === "Failed to fetch") {
            hint =
              "Docs live: direct HTTP to app-api and the extension proxy both failed. Reload the extension, run npm run dev:app, refresh the tab, or use Get feedback in this side panel. (Ishika-style flow: commit 1011aca on csen-174-s26-team-project-write-up.)";
          } else if (m.includes("bad_target")) {
            hint = "Extension blocked that URL (reload the extension after an update).";
          } else if (m.includes("Receiving end") || m.includes("message port")) {
            hint = "Extension background is not running. Open chrome://extensions and reload Write Up, then refresh this doc.";
          }
          updateLiveState({ liveDocsStatus: hint });
        })
        .finally(() => {
          inFlight = false;
        });
    });
  }

  function start() {
    if (observer) return;
    const target = document.getElementById("docs-editor") || document.querySelector(".kix-appview-editor") || document.body;
    observer = new MutationObserver(() => schedule());
    observer.observe(target, { subtree: true, characterData: true, childList: true });
    document.addEventListener("keyup", schedule, true);
    document.addEventListener("paste", schedule, true);
    pollTimer = setInterval(() => {
      schedule();
    }, POLL_EVERY_MS);
    schedule();
  }

  function stop() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (observer) observer.disconnect();
    observer = null;
    document.removeEventListener("keyup", schedule, true);
    document.removeEventListener("paste", schedule, true);
    updateLiveState({ liveDocsStatus: "", liveDocsFeedback: "", liveDocsUpdatedAt: 0 });
  }

  let storageWired = false;

  function wireStorageAndMaybeStart() {
    if (storageWired || !hasStorage()) return;
    storageWired = true;

    chrome.storage.local.get({ docsLiveEnabled: false }, (cfg) => {
      if (cfg.docsLiveEnabled) start();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.docsLiveUseMcp) lastDigest = "";
      if (!changes.docsLiveEnabled) return;
      if (changes.docsLiveEnabled.newValue) {
        lastDigest = "";
        start();
      } else {
        stop();
      }
    });
  }

  function mountWhenEditorReady() {
    if (editorMountNode()) {
      wireStorageAndMaybeStart();
      return;
    }
    const boot = new MutationObserver(() => {
      if (editorMountNode()) {
        boot.disconnect();
        wireStorageAndMaybeStart();
      }
    });
    boot.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => boot.disconnect(), 120000);
  }

  mountWhenEditorReady();
})();

