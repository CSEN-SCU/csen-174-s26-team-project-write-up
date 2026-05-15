const APP_API_BASE = "http://127.0.0.1:5050";
const DEFAULT_API_BASE = APP_API_BASE;
globalThis.writeUpApiBaseForDebug = APP_API_BASE;

const appFetch = typeof globalThis.writeUpFetchAppApi === "function" ? globalThis.writeUpFetchAppApi : fetch.bind(globalThis);

/** Abort slow /coach (LLM chain). Side panel uses direct `fetch`, which honors `signal`. */
const COACH_FETCH_TIMEOUT_MS = 125000;
function coachFetchWithDeadline(url, options) {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), COACH_FETCH_TIMEOUT_MS);
  const merged = { ...(options || {}), signal: ac.signal };
  return appFetch(url, merged).finally(() => clearTimeout(tid));
}

async function buildAppApiHeaders() {
  if (typeof globalThis.writeUpBuildApiHeaders === "function") {
    return globalThis.writeUpBuildApiHeaders();
  }
  const h = { "Content-Type": "application/json" };
  if (/127\.0\.0\.1|localhost/i.test(APP_API_BASE)) {
    h["X-Debug-User"] = "local-extension-user";
  }
  return h;
}

function isExtensionContextInvalidated(err) {
  const m = err && (err.message || String(err));
  return typeof m === "string" && m.includes("Extension context invalidated");
}

function coachPersonalizationPayload() {
  const d = globalThis.writeUpDefaultCoachPersonalization;
  if (d && typeof d === "object") return { ...d };
  return { goals: "", audience: "", tonePreference: "neutral" };
}

/** Plain-text feedback from /coach JSON (fallback if `feedback` string missing). */
function coachFeedbackDisplayText(data) {
  if (!data || typeof data !== "object") {
    return "Unexpected empty response from /coach.";
  }
  const fb = typeof data.feedback === "string" ? data.feedback.trim() : "";
  if (fb) return data.feedback;
  const list = Array.isArray(data.suggestions)
    ? data.suggestions
    : Array.isArray(data.cards)
      ? data.cards
      : [];
  if (!list.length) {
    return "The coach returned no suggestions. If this persists, confirm npm run dev:coach and set OPENAI_API_KEY or GROQ_API_KEY for full LLM feedback.";
  }
  return list
    .map((s, i) => {
      const title = String(s?.title || "Note").trim();
      const body = String(s?.body || "").trim();
      const me =
        s?.micro_edit != null && String(s.micro_edit).trim() !== ""
          ? `\nTry: ${s.micro_edit}`
          : "";
      return `${i + 1}. ${title}\n${body}${me}`;
    })
    .join("\n\n");
}

let coachRequestInFlight = false;
const WORD_BANK_DISPLAY_COUNT = 8;

const homeLink = document.getElementById("home-link");
const submitBtn = document.getElementById("submit-btn");
const draft = document.getElementById("draft");
const output = document.getElementById("output");
const outputMeta = document.getElementById("output-meta");
const statusLine = document.getElementById("status-line");
statusLine.textContent = "Your feedback will appear below.";

const wordBankList = document.getElementById("wordbank-list");
const tabFeedback = document.getElementById("tab-feedback");
const tabWordBank = document.getElementById("tab-wordbank");
const panelFeedback = document.getElementById("panel-feedback");
const panelWordBank = document.getElementById("panel-wordbank");
const docsLiveEnabled = document.getElementById("docs-live-enabled");
const docsLiveUseMcp = document.getElementById("docs-live-use-mcp");
const docsLiveStatus = document.getElementById("docs-live-status");
const docsLiveOutput = document.getElementById("docs-live-output");
const appApiLinkStatus = document.getElementById("app-api-link-status");

function getApiBase() {
  return DEFAULT_API_BASE;
}

function landingPageUrl(apiBase) {
  const base = (apiBase || DEFAULT_API_BASE).trim().replace(/\/$/, "");
  return `${base || DEFAULT_API_BASE}/`;
}

function syncHomeLinkHref(apiBase) {
  if (homeLink) homeLink.href = landingPageUrl(apiBase);
}

function selectedFocus() {
  return Array.from(document.querySelectorAll('input[name="focus"]:checked')).map((el) => el.value);
}

function persistLiveSettings() {
  if (!chrome?.storage?.local) return;
  try {
    const enabled = !!docsLiveEnabled?.checked;
    const payload = {
      docsLiveEnabled: enabled,
      docsLiveUseMcp: !!docsLiveUseMcp?.checked,
      docsLiveFocus: selectedFocus(),
    };
    if (!enabled) {
      payload.liveDocsStatus = "";
      payload.liveDocsFeedback = "";
      payload.liveDocsUpdatedAt = 0;
      if (docsLiveStatus) docsLiveStatus.textContent = "";
      if (docsLiveOutput) {
        docsLiveOutput.textContent = "Enable live mode, then type in a Google Doc.";
      }
    }
    chrome.storage.local.set(payload);
  } catch (_) {
    /* e.g. Extension context invalidated after reload */
  }
}

function hydrateLiveSettings() {
  if (!chrome?.storage?.local) return;
  try {
    chrome.storage.local.get(
      {
        docsLiveEnabled: false,
        docsLiveUseMcp: false,
        docsLiveFocus: ["vocabulary", "tone"],
        liveDocsStatus: "",
        liveDocsFeedback: "",
        liveDocsUpdatedAt: 0,
      },
      (state) => {
        try {
          if (chrome.runtime.lastError) return;
          if (docsLiveEnabled) docsLiveEnabled.checked = !!state.docsLiveEnabled;
          if (docsLiveUseMcp) docsLiveUseMcp.checked = !!state.docsLiveUseMcp;
          if (Array.isArray(state.docsLiveFocus)) {
            document.querySelectorAll('input[name="focus"]').forEach((el) => {
              el.checked = state.docsLiveFocus.includes(el.value);
            });
          }
          if (!state.docsLiveEnabled) {
            renderLiveStatus("", 0);
            if (docsLiveOutput) {
              docsLiveOutput.textContent = "Enable live mode, then type in a Google Doc.";
            }
          } else {
            renderLiveStatus(state.liveDocsStatus, state.liveDocsUpdatedAt);
            if (docsLiveOutput && state.liveDocsFeedback) {
              docsLiveOutput.textContent = state.liveDocsFeedback;
            }
          }
        } catch (_) {
          /* Extension context invalidated */
        }
      },
    );
  } catch (_) {
    /* Extension context invalidated */
  }
}

function renderLiveStatus(statusText, updatedAt) {
  if (!docsLiveStatus) return;
  const bits = [];
  if (statusText) bits.push(statusText);
  if (updatedAt) {
    try {
      bits.push(new Date(updatedAt).toLocaleTimeString());
    } catch (_) {
      // no-op
    }
  }
  docsLiveStatus.textContent = bits.join(" · ");
}

/** Map Firestore feedback_history row or legacy {from,to} into a word-bank pair. */
function wordBankPairFromItem(item) {
  if (!item) return null;
  const legacyFrom = String(item.from || "").trim();
  const legacyTo = String(item.to || "").trim();
  if (legacyFrom && legacyTo) return { from: legacyFrom, to: legacyTo };
  const issue = String(item.issue || "").trim();
  const fixes = Array.isArray(item.fixOptions) ? item.fixOptions : [];
  const to = String(fixes[0] || "").trim() || String(item.why || "").trim().slice(0, 200);
  if (!issue && !to) return null;
  return { from: issue || "Tip", to: to || "—" };
}

function pickRandomPairs(items, count) {
  const unique = [];
  const seen = new Set();
  for (const item of items || []) {
    const pair = wordBankPairFromItem(item);
    if (!pair) continue;
    const from = pair.from;
    const to = pair.to;
    const key = `${from.toLowerCase()}=>${to.toLowerCase()}`;
    if (!from || !to || seen.has(key)) continue;
    seen.add(key);
    unique.push({ from, to });
  }
  for (let i = unique.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, count);
}

function renderWordBank(items) {
  if (!wordBankList) return;
  if (!items || items.length === 0) {
    wordBankList.innerHTML = '<p class="wordbank-empty">No saved words yet.</p>';
    return;
  }
  const pairs = pickRandomPairs(items, WORD_BANK_DISPLAY_COUNT);
  const html = pairs
    .map((pair) => {
      const safeFrom = pair.from.replace(/</g, "&lt;");
      const safeTo = pair.to.replace(/</g, "&lt;");
      return `<div class="wordbank-item"><div class="wordbank-old">${safeFrom}</div><div class="wordbank-new">${safeTo}</div></div>`;
    })
    .join("");
  wordBankList.innerHTML = html || '<p class="wordbank-empty">No saved words yet.</p>';
}

async function loadWordBank() {
  const base = APP_API_BASE;
  try {
    const headers = await buildAppApiHeaders();
    const res = await appFetch(`${base}/feedback-history?docId=active`, {
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return renderWordBank([]);
    renderWordBank(Array.isArray(data.items) ? data.items : []);
  } catch (_) {
    renderWordBank([]);
  }
}

async function runFeedback() {
  const text = draft.value.trim();
  if (!text) return (statusLine.textContent = "Add some text first.");
  const focus = selectedFocus();
  if (focus.length === 0) {
    statusLine.textContent = "Pick at least one focus: vocabulary, tone, or clarity.";
    return;
  }

  if (coachRequestInFlight) {
    statusLine.textContent = "Still waiting for the previous Get feedback request.";
    return;
  }
  coachRequestInFlight = true;

  submitBtn.disabled = true;
  statusLine.textContent = "Calling app-api → coaching-api…";
  output.textContent = "";
  output.classList.remove("output-placeholder", "is-error");
  outputMeta.textContent = "";

  try {
    const headers = await buildAppApiHeaders();
    const res = await coachFetchWithDeadline(`${APP_API_BASE}/coach`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        focus,
        surface: "extension",
        ...coachPersonalizationPayload(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      output.classList.add("is-error");
      const hint = data.hint ? ` ${data.hint}` : "";
      const baseMsg = data.message || data.error || "";
      let detail =
        data.error === "missing_token"
          ? "Auth missing: add APP_ENV=dev and APP_AUTH_BYPASS=1 to app-api .env, restart npm run dev:app, or use Sign in (web) for a Firebase token."
          : data.error === "missing_debug_user"
            ? "Auth bypass is on but the request had no X-Debug-User. Reload the extension (a stale saved token can cause this) or use Clear token."
            : data.error === "server_misconfigured"
              ? baseMsg + hint ||
                "Set COACHING_INTERNAL_SECRET in app-api .env (same random string as coaching-api)."
              : data.error === "coaching_upstream" || data.error === "coaching_bad_response"
                ? (baseMsg + hint + " Run npm run dev:coach; COACHING_API_BASE_URL should be http://127.0.0.1:8787 and the secret must match both .env files.").trim()
                : data.error === "coaching_timeout"
                  ? baseMsg + hint ||
                    "Coaching-api or the LLM took too long. Try a shorter paragraph or raise COACHING_HTTP_TIMEOUT_S / COACH_LLM_HTTP_TIMEOUT_MS."
                  : data.error === "unauthorized" && res.status === 401
                    ? (baseMsg + hint).trim() ||
                      "Coaching-api rejected the internal secret. Align COACHING_INTERNAL_SECRET in repo .env for app-api and coaching-api."
                    : `${baseMsg}${hint}`.trim() || `Request failed (${res.status}).`;
      output.textContent = detail;
      statusLine.textContent = "Error";
      return;
    }
    output.textContent = coachFeedbackDisplayText(data);
    const metaParts = [];
    if (data.model) metaParts.push(`Model: ${data.model}`);
    if (typeof data.vocabulary_pairs_saved === "number" && data.vocabulary_pairs_saved > 0) {
      metaParts.push(`Saved ${data.vocabulary_pairs_saved} vocab pair(s)`);
    }
    if (outputMeta) outputMeta.textContent = metaParts.join(" · ");
    statusLine.textContent = "Done";

    void (async () => {
      let persistMsg = "";
      try {
        if (typeof writeUpPersistCoachSuggestions === "function") {
          const { saved, total } = await writeUpPersistCoachSuggestions(
            APP_API_BASE,
            null,
            "active",
            data,
          );
          if (total > 0) persistMsg = ` · Saved ${saved}/${total} to history`;
        }
      } catch (_) {
        persistMsg = " · History save skipped";
      }
      statusLine.textContent = `Done${persistMsg}`;
      try {
        await loadWordBank();
      } catch (_) {
        /* ignore */
      }
    })();
  } catch (e) {
    output.classList.add("is-error");
    if (isExtensionContextInvalidated(e)) {
      output.textContent =
        "Extension was reloaded. Close this side panel, click the Write Up toolbar icon again, then retry.";
    } else {
      const msg = e && e.message ? String(e.message) : "";
      const aborted = (e && e.name === "AbortError") || /aborted|AbortError/i.test(msg);
      output.textContent = aborted
        ? `Timed out after ${COACH_FETCH_TIMEOUT_MS / 1000}s waiting for /coach. Run npm run dev:app and npm run dev:coach; try a shorter paragraph or set COACH_LLM_HTTP_TIMEOUT_MS.`
        : msg === "Failed to fetch"
          ? "Network error (Failed to fetch): reload the Write Up extension on chrome://extensions, run `npm run dev:app` and `npm run dev:coach`, and confirm http://127.0.0.1:5050 loads in a normal tab."
          : msg.includes("Timed out after")
            ? msg
            : msg ||
              "Could not reach app-api at http://127.0.0.1:5050 (coach proxy). Run `npm run dev:app` and `npm run dev:coach` from the repo root.";
    }
    statusLine.textContent = "Network error";
  } finally {
    coachRequestInFlight = false;
    submitBtn.disabled = false;
  }
}

function setActiveTab(tabName) {
  const feedbackActive = tabName === "feedback";
  tabFeedback.classList.toggle("is-active", feedbackActive);
  tabWordBank.classList.toggle("is-active", !feedbackActive);
  tabFeedback.setAttribute("aria-selected", feedbackActive ? "true" : "false");
  tabWordBank.setAttribute("aria-selected", feedbackActive ? "false" : "true");
  panelFeedback.classList.toggle("is-active", feedbackActive);
  panelWordBank.classList.toggle("is-active", !feedbackActive);
  panelFeedback.hidden = !feedbackActive;
  panelWordBank.hidden = feedbackActive;
}

async function warmupAppApi() {
  if (!appApiLinkStatus) return;
  appApiLinkStatus.textContent =
    "Checking app-api and coaching-api at http://127.0.0.1:5050 / :8787…";
  try {
    const headers = await buildAppApiHeaders();
    const res = await appFetch(`${APP_API_BASE}/health?coach=1`, { method: "GET", headers });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.ok === true || data.service === "app-api")) {
      const baseCoach = data.coaching_api_base_url || "http://127.0.0.1:8787";
      if (data.coach_proxy_secret_configured === false) {
        appApiLinkStatus.textContent =
          "App-api: OK. Set COACHING_INTERNAL_SECRET in app-api .env (same value as coaching-api) so POST /coach can reach the coach.";
        return;
      }
      if (data.coaching_api_reachable === false) {
        appApiLinkStatus.textContent = `App-api: OK. Coaching-api not reachable at ${baseCoach} — run npm run dev:coach from the repo root, then reload this panel.`;
        return;
      }
      if (data.coaching_api_reachable === true) {
        appApiLinkStatus.textContent =
          "App-api and coaching-api are reachable. Paste text below and click Get feedback (Flask logs POST /coach).";
        return;
      }
      appApiLinkStatus.textContent =
        "App-api: connected. Update app-api for /health?coach=1 checks, or run npm run dev:coach and try Get feedback.";
      return;
    }
    appApiLinkStatus.textContent = `App-api: HTTP ${res.status}. Is npm run dev:app running?`;
  } catch (e) {
    const m = e && e.message ? String(e.message) : "error";
    appApiLinkStatus.textContent =
      m === "bad_target"
        ? "App-api: extension rejected URL (reload Write Up on chrome://extensions after an update)."
        : `${m} — Reload the extension, run npm run dev:app, then try again. For details: chrome://extensions → Write Up → service worker → Inspect.`;
  }
}

async function init() {
  setActiveTab("feedback");
  syncHomeLinkHref(getApiBase());
  await warmupAppApi();
  await loadWordBank();
  hydrateLiveSettings();
}

document.getElementById("ext-signout-btn")?.addEventListener("click", async () => {
  if (typeof writeUpClearAuthToken === "function") {
    await writeUpClearAuthToken();
  }
  statusLine.textContent = "Cleared saved token. Local debug user still works on localhost.";
});

submitBtn.addEventListener("click", runFeedback);
tabFeedback.addEventListener("click", () => setActiveTab("feedback"));
tabWordBank.addEventListener("click", async () => {
  setActiveTab("wordbank");
  await loadWordBank();
});
document.querySelectorAll('input[name="focus"]').forEach((el) => el.addEventListener("change", persistLiveSettings));
docsLiveEnabled?.addEventListener("change", persistLiveSettings);
docsLiveUseMcp?.addEventListener("change", persistLiveSettings);

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    try {
      if (areaName !== "local") return;
      if (changes.docsLiveEnabled && changes.docsLiveEnabled.newValue === false) {
        renderLiveStatus("", 0);
        if (docsLiveOutput) {
          docsLiveOutput.textContent = "Enable live mode, then type in a Google Doc.";
        }
      }
      if (changes.liveDocsFeedback && docsLiveOutput) {
        if (!docsLiveEnabled?.checked) return;
        docsLiveOutput.textContent = changes.liveDocsFeedback.newValue || "";
      }
      if (changes.liveDocsStatus || changes.liveDocsUpdatedAt) {
        if (!docsLiveEnabled?.checked) {
          renderLiveStatus("", 0);
          return;
        }
        const statusText = changes.liveDocsStatus?.newValue;
        const updatedAt = changes.liveDocsUpdatedAt?.newValue;
        chrome.storage.local.get({ liveDocsStatus: "", liveDocsUpdatedAt: 0 }, (state) => {
          try {
            if (chrome.runtime.lastError) return;
            renderLiveStatus(statusText ?? state.liveDocsStatus, updatedAt ?? state.liveDocsUpdatedAt);
          } catch (_) {
            /* ignore */
          }
        });
      }
    } catch (_) {
      /* Extension context invalidated */
    }
  });
}

init();

