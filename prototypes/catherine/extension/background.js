chrome.runtime.onInstalled.addListener(async () => {
  const { userId } = await chrome.storage.local.get("userId");
  if (!userId) {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `wu_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await chrome.storage.local.set({ userId: id });
  }
  const { apiBase } = await chrome.storage.sync.get("apiBase");
  if (!apiBase) {
    await chrome.storage.sync.set({ apiBase: "http://localhost:3847" });
  }
  const { writingLevel } = await chrome.storage.sync.get("writingLevel");
  if (!writingLevel) {
    await chrome.storage.sync.set({ writingLevel: "college" });
  }
  const { writingGoals } = await chrome.storage.sync.get("writingGoals");
  if (!Array.isArray(writingGoals) || !writingGoals.length) {
    await chrome.storage.sync.set({
      writingGoals: ["vocabulary", "pedagogy"],
    });
  }
  chrome.contextMenus.removeAll(() => {
    try {
      chrome.contextMenus.create({
        id: "writeup-analyze-selection",
        title: "Analyze with Write Up",
        contexts: ["selection"],
      });
    } catch {
      /* ignore */
    }
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "writeup-analyze-selection") return;
  const text = String(info.selectionText || "").trim();
  if (!tab?.id) return;
  if (!text) {
    await notifyToast(tab.id, "No selection text was provided — try again.");
    return;
  }
  await runAnalyzeWithText(tab.id, text, "context_menu");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "analyze-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await runAnalyzeSelection(tab.id);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ANALYZE_TEXT") {
    handleAnalyze(message.payload)
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    return true;
  }
  if (message?.type === "POPUP_ANALYZE_SELECTION") {
    const tabId = message.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return false;
    }
    runAnalyzeSelection(tabId)
      .then((out) => sendResponse({ ok: true, ...out }))
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    return true;
  }
  if (message?.type === "POPUP_ANALYZE_TEXT") {
    const { tabId, text } = message;
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return false;
    }
    runAnalyzeWithText(tabId, String(text || "").trim(), "clipboard")
      .then((out) => sendResponse({ ok: true, ...out }))
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    return true;
  }
  return false;
});

/** Only the top frame should show panels/toasts (avoids duplicate UI in ad iframes). */
const TOP_FRAME = { frameId: 0 };

async function notifyToast(tabId, text) {
  try {
    await chrome.tabs.sendMessage(
      tabId,
      {
        type: "WRITEUP_TOAST",
        message: text,
      },
      TOP_FRAME
    );
  } catch {
    /* no receiver */
  }
}

/**
 * Injected into every frame. Self-contained: Google Docs often returns "" from
 * getSelection(); we fall back to the Kix editor DOM (similar idea to other
 * writing extensions — not as robust as the official Docs API).
 */
function collectWritableTextFromFrame() {
  function selectionText() {
    try {
      const s = window.getSelection && window.getSelection();
      return s ? String(s.toString() || "") : "";
    } catch {
      return "";
    }
  }

  function googleDocsEditorPlain() {
    try {
      const host = String(location.hostname || "");
      if (!host.includes("docs.google.com")) return "";
      const ed =
        document.querySelector(".kix-appview-editor") ||
        document.querySelector(".kix-page-content-wrapper") ||
        document.querySelector('[role="textbox"]');
      if (!ed) return "";
      let t = ed.innerText || ed.textContent || "";
      t = t.replace(/\u200b/g, "").replace(/\u00a0/g, " ");
      t = t.replace(/\r\n/g, "\n").trim();
      return t.slice(0, 25000);
    } catch {
      return "";
    }
  }

  const sel = selectionText().trim();
  if (sel.length > 0) {
    return { text: sel.slice(0, 25000), source: "selection" };
  }
  const doc = googleDocsEditorPlain();
  if (doc.length > 0) {
    return { text: doc, source: "google_doc_body" };
  }
  return { text: "", source: "none" };
}

function pickBestFrameResult(results) {
  let best = null;
  for (const row of results || []) {
    const o = row && row.result;
    if (!o || typeof o !== "object") continue;
    const t = String(o.text || "").trim();
    if (!t) continue;
    if (!best) {
      best = o;
      continue;
    }
    const bt = String(best.text || "").trim();
    if (o.source === "selection" && best.source !== "selection") {
      best = o;
      continue;
    }
    if (o.source === "selection" && best.source === "selection" && t.length > bt.length) {
      best = o;
      continue;
    }
    if (best.source !== "selection" && o.source !== "selection" && t.length > bt.length) {
      best = o;
    }
  }
  return best;
}

function chipFromSource(src) {
  if (src === "selection") return "selection";
  if (src === "google_doc_body") return "Google Doc (visible text)";
  if (src === "clipboard") return "clipboard";
  if (src === "context_menu") return "Right-click selection";
  return "page";
}

function mapTextAcquisition(sourceKey) {
  if (sourceKey === "google_doc_body") return "google_doc_body";
  if (sourceKey === "clipboard") return "clipboard";
  if (sourceKey === "context_menu") return "selection";
  if (sourceKey === "selection") return "selection";
  return "selection";
}

async function runAnalyzeWithText(tabId, trimmed, sourceKey) {
  if (!trimmed) {
    await notifyToast(tabId, "No text to analyze.");
    return { outcome: "no_selection" };
  }

  const tab = await chrome.tabs.get(tabId);
  const sync = await chrome.storage.sync.get([
    "apiBase",
    "writingLevel",
    "writingGoals",
    "pieceContext",
  ]);
  const { writeupCatherineGrammarDict } = await chrome.storage.local.get(
    "writeupCatherineGrammarDict"
  );
  const goals = Array.isArray(sync.writingGoals) ? sync.writingGoals : [];
  const pieceContext = String(sync.pieceContext || "").trim().slice(0, 500);
  const grammarDictionary = Array.isArray(writeupCatherineGrammarDict)
    ? writeupCatherineGrammarDict
    : [];
  const payload = {
    text: trimmed,
    writingLevel: sync.writingLevel || "college",
    writingGoals: goals.length ? goals : ["vocabulary", "pedagogy"],
    pieceContext,
    grammarDictionary,
    sourceUrl: tab.url || "",
    apiBase: sync.apiBase || "http://localhost:3847",
    textAcquisition: mapTextAcquisition(sourceKey),
  };

  let data;
  try {
    data = await handleAnalyze(payload);
  } catch (e) {
    await notifyToast(tabId, e instanceof Error ? e.message : String(e));
    return { outcome: "api_error" };
  }

  try {
    await chrome.tabs.sendMessage(
      tabId,
      {
        type: "WRITEUP_SHOW_PANEL",
        payload: data,
        ctx: {
          source: chipFromSource(sourceKey),
          highlightEl: null,
          fullText: trimmed,
        },
      },
      TOP_FRAME
    );
    return { outcome: "ok" };
  } catch {
    await notifyToast(
      tabId,
      "Could not show the panel — refresh the tab and try again."
    );
    return { outcome: "panel_error" };
  }
}

async function runAnalyzeSelection(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: collectWritableTextFromFrame,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyToast(
      tabId,
      `Could not read this page (${msg}). Grant the extension access to this site or refresh the tab.`
    );
    return { outcome: "script_error" };
  }

  const best = pickBestFrameResult(results);
  const text = best && String(best.text || "").trim() ? String(best.text).trim() : "";
  const sourceKey = best && best.source ? best.source : "none";

  const tabEarly = await chrome.tabs.get(tabId).catch(() => null);
  const isGoogleDoc = Boolean(
    tabEarly?.url && tabEarly.url.includes("docs.google.com")
  );

  if (!text) {
    const hint = isGoogleDoc
      ? "Could not read this Google Doc (canvas mode or permissions). Copy your paragraph (Ctrl+C), open the Write Up popup, and click Analyze clipboard."
      : "No text found — select content on the page, then try again.";
    await notifyToast(tabId, hint);
    return { outcome: "no_selection" };
  }

  return runAnalyzeWithText(tabId, text, sourceKey);
}

async function handleAnalyze(payload) {
  const {
    text,
    writingLevel,
    writingGoals,
    pieceContext = "",
    grammarDictionary = [],
    sourceUrl,
    apiBase,
    textAcquisition = "selection",
  } = payload;
  const { userId } = await chrome.storage.local.get("userId");
  if (!userId) throw new Error("Missing local user id");

  const base = (apiBase || "http://localhost:3847").replace(/\/$/, "");
  const url = `${base}/api/analyze`;
  const goals = Array.isArray(writingGoals) ? writingGoals : [];
  const gd = Array.isArray(grammarDictionary) ? grammarDictionary : [];
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      text,
      writingLevel,
      writingGoals: goals.length ? goals : ["vocabulary", "pedagogy"],
      pieceContext: String(pieceContext || "").trim().slice(0, 500),
      grammarDictionary: gd,
      sourceUrl,
      textAcquisition,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}
