// TODO(EXT-3): add inline highlight rendering from returned card spans.
/**
 * Experimental Google Docs live capture.
 * Supports direct DOM text mode and MCP bridge mode (doc_id only).
 */
(function () {
  const API_BASE = "http://127.0.0.1:8787";
  const DEBOUNCE_MS = 2800;
  const MIN_CHARS = 72;
  const MIN_FETCH_GAP_MS = 3500;
  const POLL_EVERY_MS = 4000;
  const MAX_CHARS = 9000;

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
    const editorRoot = document.querySelector(".kix-appview-editor") || document.body;
    const lineBlocks = editorRoot.querySelectorAll(".kix-lineview-text-block");
    const lines = [];
    if (lineBlocks.length) {
      lineBlocks.forEach((el) => {
        const text = (el.textContent || "").replace(/\u00a0/g, " ").trim();
        if (text) lines.push(text);
      });
    }
    const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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

  async function callFeedback(payload) {
    const res = await fetch(`${API_BASE}/coach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
      const text = useMcp ? "" : extractDocsText();
      if (!useMcp && text.length < MIN_CHARS) {
        updateLiveState({ liveDocsStatus: "Draft too short for live snapshot." });
        return;
      }

      const digest = digestOf(text, useMcp, docId);
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
      updateLiveState({ liveDocsStatus: useMcp ? "Calling MCP bridgeâ€¦" : "Calling local feedbackâ€¦", liveDocsDocId: docId });

      callFeedback({
        text,
        focus: Array.isArray(cfg.docsLiveFocus) ? cfg.docsLiveFocus : ["vocabulary", "tone"],
        live: true,
        use_mcp: useMcp,
        doc_id: docId,
      })
        .then((data) => {
          updateLiveState({
            liveDocsStatus: `Updated (${data.source || "text"})`,
            liveDocsFeedback: data.feedback || "",
            liveDocsUpdatedAt: Date.now(),
          });
        })
        .catch((err) => {
          lastDigest = "";
          updateLiveState({
            liveDocsStatus:
              (err && err.message) || "Live request failed. Check server and MCP bridge config.",
          });
        })
        .finally(() => {
          inFlight = false;
        });
    });
  }

  function start() {
    if (observer) return;
    const target = document.querySelector(".kix-appview-editor") || document.body;
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
  }

  if (hasStorage()) {
    chrome.storage.local.get({ docsLiveEnabled: false }, (cfg) => {
      if (cfg.docsLiveEnabled) start();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.docsLiveEnabled) return;
      if (changes.docsLiveEnabled.newValue) {
        lastDigest = "";
        start();
      } else {
        stop();
      }
    });
  }
})();

