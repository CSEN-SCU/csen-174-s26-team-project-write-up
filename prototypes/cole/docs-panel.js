const DOC_TEXT_URL = "http://127.0.0.1:8765/api/docs/text";
const DOC_CHECK_URL = "http://127.0.0.1:8765/api/docs/check";
const CLIP_MSG_TYPE = "COLE_GROQ_CLIPBOARD_TEXT";
const PANEL_VERSION = "cole-docs-panel v4 (modules)";
const REFRESH_EVERY_MS = 12000;

function ensurePanel() {
  const existing = document.getElementById("cole-groq-panel-root");
  if (existing) return existing;

  const root = document.createElement("div");
  root.id = "cole-groq-panel-root";
  root.setAttribute("role", "complementary");
  root.setAttribute("aria-label", "Groq helper panel");

  const style = document.createElement("style");
  style.textContent = `
    :root {
      --cole-paper: #f6f2ea;
      --cole-ink: #15171c;
      --cole-muted: rgba(21, 23, 28, 0.62);
      --cole-border: rgba(21, 23, 28, 0.14);
      --cole-shadow: rgba(20, 24, 32, 0.18);

      --cole-red: rgba(220, 82, 66, 0.16);
      --cole-green: rgba(40, 150, 90, 0.16);
      --cole-blue: rgba(56, 126, 214, 0.16);
    }
    #cole-groq-panel-root {
      position: fixed;
      top: 72px;
      right: 16px;
      width: 360px;
      height: calc(100vh - 96px);
      z-index: 2147483647;
      background: var(--cole-paper);
      color: var(--cole-ink);
      border: 1px solid var(--cole-border);
      border-radius: 14px;
      box-shadow: 0 18px 60px var(--cole-shadow);
      overflow: hidden;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      display: flex;
      flex-direction: column;
    }
    #cole-groq-panel-root * { box-sizing: border-box; }
    #cole-groq-panel-root .hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--cole-border);
      background: rgba(255,255,255,0.55);
      flex: 0 0 auto;
    }
    #cole-groq-panel-root .hdr strong { font-size: 13px; letter-spacing: 0.01em; }
    #cole-groq-panel-root .hdr .sub { font-size: 11px; color: var(--cole-muted); }
    #cole-groq-panel-root .hdr .btn {
      border: 1px solid var(--cole-border);
      background: rgba(255,255,255,0.65);
      color: var(--cole-ink);
      border-radius: 10px;
      padding: 6px 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
    }
    #cole-groq-panel-root .body {
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      flex: 1 1 auto;
      overflow: hidden;
    }
    #cole-groq-panel-root label {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.7;
      display: block;
      margin-bottom: 5px;
    }
    #cole-groq-panel-root .meta {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--cole-muted);
    }
    #cole-groq-panel-root .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 999px;
      border: 1px solid var(--cole-border);
      background: rgba(255,255,255,0.6);
      max-width: 100%;
    }
    #cole-groq-panel-root .pill code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      opacity: 0.9;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #cole-groq-panel-root .row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    #cole-groq-panel-root .status { font-size: 12px; color: var(--cole-muted); min-height: 16px; }
    #cole-groq-panel-root .hint { font-size: 11px; color: var(--cole-muted); line-height: 1.35; }
    #cole-groq-panel-root .hint code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    #cole-groq-panel-root .modules {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding-right: 2px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overscroll-behavior: contain;
    }
    #cole-groq-panel-root .module {
      border: 1px solid var(--cole-border);
      background: rgba(255,255,255,0.62);
      border-radius: 12px;
      overflow: hidden;
    }
    #cole-groq-panel-root .module.is-spelling { background: var(--cole-red); }
    #cole-groq-panel-root .module.is-grammar { background: var(--cole-green); }
    #cole-groq-panel-root .module.is-style { background: var(--cole-blue); }
    #cole-groq-panel-root .module-h {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(21, 23, 28, 0.12);
      background: rgba(255,255,255,0.55);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.01em;
    }
    #cole-groq-panel-root .count {
      font-size: 11px;
      color: var(--cole-muted);
      font-weight: 600;
    }
    #cole-groq-panel-root .issue-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      max-height: 240px;
      overflow: auto;
      overscroll-behavior: contain;
    }
    #cole-groq-panel-root .issue {
      border: 1px solid rgba(21, 23, 28, 0.14);
      border-radius: 10px;
      background: rgba(255,255,255,0.72);
      padding: 8px 9px;
    }
    #cole-groq-panel-root .issue .sev {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cole-muted);
      margin-bottom: 6px;
    }
    #cole-groq-panel-root .issue .excerpt {
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    #cole-groq-panel-root .issue .msg {
      margin-top: 6px;
      font-size: 11.5px;
      color: rgba(21, 23, 28, 0.9);
    }
    #cole-groq-panel-root .issue .fix {
      margin-top: 6px;
      padding: 7px 8px;
      border-radius: 9px;
      border: 1px dashed rgba(21, 23, 28, 0.28);
      background: rgba(255,255,255,0.75);
      font-size: 12px;
      white-space: pre-wrap;
    }
  `;

  root.innerHTML = `
    <div class="hdr">
      <div style="min-width:0;">
        <strong>Write Helper</strong>
        <div class="sub">Spelling · Grammar · Style</div>
      </div>
      <button type="button" class="btn" id="cole-groq-panel-close" title="Hide panel">Hide</button>
    </div>
    <div class="body">
      <div class="meta">
        <span class="pill" title="Current Google Doc ID"><span>Doc</span> <code id="cole-doc-id">—</code></span>
        <div class="row">
          <button type="button" class="btn" id="cole-refresh" title="Refresh analysis">Refresh</button>
        </div>
      </div>
      <div class="status" id="cole-status">Loading…</div>
      <div class="modules" id="cole-modules"></div>
      <div class="hint">
        <div><code>${PANEL_VERSION}</code></div>
        Requires local bridge at <code>${DOC_TEXT_URL}</code> (run <code>py groqapi.py</code> in <code>prototypes/cole</code>).
      </div>
    </div>
  `;

  // Attach styles + root
  (document.head || document.documentElement).appendChild(style);
  document.documentElement.appendChild(root);

  // Wire events
  const closeBtn = root.querySelector("#cole-groq-panel-close");
  const statusEl = root.querySelector("#cole-status");
  const modulesEl = root.querySelector("#cole-modules");
  const docIdEl = root.querySelector("#cole-doc-id");
  const refreshBtn = root.querySelector("#cole-refresh");
  let lastTextHash = "";
  let inFlight = false;
  let timer = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function getDocIdFromUrl() {
    const m = String(location.pathname || "").match(/\/document\/d\/([^/]+)/);
    return m ? m[1] : "";
  }
  closeBtn?.addEventListener("click", () => root.remove());

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderModule(title, items, kind) {
    const safeTitle = escapeHtml(title);
    const count = Array.isArray(items) ? items.length : 0;
    const klass =
      kind === "spelling" ? "is-spelling" : kind === "grammar" ? "is-grammar" : kind === "style" ? "is-style" : "";
    const listHtml = (items || [])
      .map((it) => {
        const sev = escapeHtml(it.severity || "low");
        const excerpt = escapeHtml(it.excerpt || "");
        const msg = escapeHtml(it.message || "");
        const fix = escapeHtml(it.suggestion || "");
        return `
          <div class="issue">
            <div class="sev">${sev}</div>
            <div class="excerpt">${excerpt}</div>
            <div class="msg">${msg}</div>
            <div class="fix">${fix}</div>
          </div>
        `;
      })
      .join("");

    return `
      <section class="module ${klass}">
        <div class="module-h">
          <span>${safeTitle}</span>
          <span class="count">${count}</span>
        </div>
        <div class="issue-list">
          ${listHtml || '<div class="status">No issues found.</div>'}
        </div>
      </section>
    `;
  }

  function renderModules(issues) {
    const groups = { spelling: [], grammar: [], style: [] };
    (issues || []).forEach((it) => {
      const t = String(it.type || "").toLowerCase();
      if (groups[t]) groups[t].push(it);
    });
    const html =
      renderModule("Spelling", groups.spelling, "spelling") +
      renderModule("Grammar", groups.grammar, "grammar") +
      renderModule("Style", groups.style, "style");
    if (modulesEl) modulesEl.innerHTML = html;
  }

  async function refreshOnce(force = false) {
    if (inFlight) return;
    const docId = getDocIdFromUrl();
    if (docIdEl) docIdEl.textContent = docId ? docId : "—";
    if (!docId) {
      setStatus("Open a Google Doc to analyze.");
      renderModules([]);
      return;
    }

    inFlight = true;
    setStatus("Reading document…");
    try {
      const textRes = await fetch(`${DOC_TEXT_URL}?doc_id=${encodeURIComponent(docId)}`);
      const textPayload = await textRes.json().catch(() => ({}));
      if (!textRes.ok) throw new Error(textPayload.error || `HTTP ${textRes.status}`);

      const text = String(textPayload.text || "");
      const textHash = String(textPayload.text_hash || "");
      if (!force && textHash && textHash === lastTextHash) {
        setStatus("Up to date.");
        return;
      }
      lastTextHash = textHash;

      if (!text.trim()) {
        setStatus("Document is empty.");
        renderModules([]);
        return;
      }

      setStatus("Analyzing with Groq…");
      const checkRes = await fetch(DOC_CHECK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, text, text_hash: textHash }),
      });
      const checkPayload = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok) throw new Error(checkPayload.error || `HTTP ${checkRes.status}`);

      renderModules(checkPayload.issues || []);
      setStatus(checkPayload.cached ? "Done (cached)." : "Done.");
    } catch (e) {
      setStatus("Error");
      renderModules([]);
      if (modulesEl) {
        modulesEl.innerHTML = `<div class=\"status\">${escapeHtml(String(e?.message || e))}</div>`;
      }
    } finally {
      inFlight = false;
    }
  }

  refreshBtn?.addEventListener("click", () => refreshOnce(true));

  // Make module scrolling work inside Google Docs (Docs often captures wheel/trackpad).
  function scrollContainerForEventTarget(target) {
    if (!target) return null;
    const issueList = target.closest ? target.closest(".issue-list") : null;
    if (issueList) return issueList;
    const module = target.closest ? target.closest(".module") : null;
    if (module) return module.querySelector ? module.querySelector(".issue-list") : null;
    return modulesEl;
  }

  function installScrollGuards() {
    if (!modulesEl) return;

    const onWheel = (e) => {
      const scroller = scrollContainerForEventTarget(e.target);
      if (!scroller) return;

      // If this scroller can't scroll, fall back to the main list.
      const canScroll = scroller.scrollHeight > scroller.clientHeight + 1;
      const fallback = modulesEl;
      const finalScroller = canScroll ? scroller : fallback;

      if (!finalScroller || finalScroller.scrollHeight <= finalScroller.clientHeight + 1) {
        return;
      }

      // Keep the scroll inside the panel.
      e.preventDefault();
      e.stopPropagation();
      finalScroller.scrollTop += e.deltaY;
    };

    modulesEl.addEventListener("wheel", onWheel, { capture: true, passive: false });
  }

  installScrollGuards();

  // Receive clipboard text from iframe content scripts.
  window.addEventListener(
    "message",
    (ev) => {
      try {
        if (!ev || !ev.data || ev.data.type !== CLIP_MSG_TYPE) return;
        const text = String(ev.data.text || "").trim();
        if (!text) return;
        setStatus("Copied text detected.");
        // Clipboard no longer drives analysis input; just trigger a refresh.
        refreshOnce(true);
      } catch (_) {
        // ignore
      }
    },
    false
  );

  // Initial load + periodic refresh.
  refreshOnce(true);
  timer = setInterval(() => refreshOnce(false), REFRESH_EVERY_MS);

  return root;
}

function extractTextFromCopyEvent(e) {
  try {
    const clipText = e?.clipboardData?.getData?.("text/plain");
    return clipText && String(clipText).trim() ? String(clipText) : "";
  } catch (_) {
    return "";
  }
}

function tryReadClipboardAsync() {
  try {
    if (!navigator?.clipboard?.readText) return Promise.resolve("");
    return navigator.clipboard.readText().then(
      (t) => (t && String(t).trim() ? String(t) : ""),
      () => ""
    );
  } catch (_) {
    return Promise.resolve("");
  }
}

function notifyTop(text) {
  const t = String(text || "").trim();
  if (!t) return;
  try {
    window.top?.postMessage({ type: CLIP_MSG_TYPE, text: t }, "*");
  } catch (_) {
    // ignore
  }
}

function installClipboardForwarder() {
  async function handle(e) {
    const fromEvent = extractTextFromCopyEvent(e);
    if (fromEvent) {
      notifyTop(fromEvent);
      return;
    }

    // Fallback: right after a user-initiated copy/cut, attempt clipboard read.
    const fromClipboard = await tryReadClipboardAsync();
    if (fromClipboard) notifyTop(fromClipboard);
  }

  document.addEventListener("copy", handle, true);
  document.addEventListener("cut", handle, true);
  // Extra safety: some copy flows trigger keydown without a useful copy event.
  document.addEventListener(
    "keydown",
    (e) => {
      const k = String(e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "c") {
        setTimeout(() => handle(e), 0);
      }
    },
    true
  );
}

// In top frame: render the panel. In all frames: forward clipboard text to top.
if (window.top === window) {
  ensurePanel();
}
installClipboardForwarder();

