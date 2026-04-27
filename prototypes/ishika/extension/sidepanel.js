const DEFAULT_API_BASE = "http://127.0.0.1:5050";
const WORD_BANK_DISPLAY_COUNT = 8;

const homeLink = document.getElementById("home-link");
const submitBtn = document.getElementById("submit-btn");
const draft = document.getElementById("draft");
const output = document.getElementById("output");
const outputMeta = document.getElementById("output-meta");
const statusLine = document.getElementById("status-line");
const wordBankList = document.getElementById("wordbank-list");
const tabFeedback = document.getElementById("tab-feedback");
const tabWordBank = document.getElementById("tab-wordbank");
const panelFeedback = document.getElementById("panel-feedback");
const panelWordBank = document.getElementById("panel-wordbank");
<<<<<<< HEAD
=======
const docsLiveEnabled = document.getElementById("docs-live-enabled");
const docsLiveUseMcp = document.getElementById("docs-live-use-mcp");
const docsLiveStatus = document.getElementById("docs-live-status");
const docsLiveOutput = document.getElementById("docs-live-output");
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755

function getApiBase() {
  return DEFAULT_API_BASE;
}

<<<<<<< HEAD
/** Landing page is served at the Flask app root (same origin as the API). */
=======
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
function landingPageUrl(apiBase) {
  const base = (apiBase || DEFAULT_API_BASE).trim().replace(/\/$/, "");
  return `${base || DEFAULT_API_BASE}/`;
}

function syncHomeLinkHref(apiBase) {
<<<<<<< HEAD
  if (homeLink) {
    homeLink.href = landingPageUrl(apiBase);
  }
=======
  if (homeLink) homeLink.href = landingPageUrl(apiBase);
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
}

function selectedFocus() {
  return Array.from(document.querySelectorAll('input[name="focus"]:checked')).map((el) => el.value);
}

<<<<<<< HEAD
=======
function persistLiveSettings() {
  if (!chrome?.storage?.local) return;
  chrome.storage.local.set({
    docsLiveEnabled: !!docsLiveEnabled?.checked,
    docsLiveUseMcp: !!docsLiveUseMcp?.checked,
    docsLiveFocus: selectedFocus(),
  });
}

function hydrateLiveSettings() {
  if (!chrome?.storage?.local) return;
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
      if (docsLiveEnabled) docsLiveEnabled.checked = !!state.docsLiveEnabled;
      if (docsLiveUseMcp) docsLiveUseMcp.checked = !!state.docsLiveUseMcp;
      if (Array.isArray(state.docsLiveFocus)) {
        document.querySelectorAll('input[name="focus"]').forEach((el) => {
          el.checked = state.docsLiveFocus.includes(el.value);
        });
      }
      renderLiveStatus(state.liveDocsStatus, state.liveDocsUpdatedAt);
      if (docsLiveOutput && state.liveDocsFeedback) {
        docsLiveOutput.textContent = state.liveDocsFeedback;
      }
    }
  );
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

>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
function pickRandomPairs(items, count) {
  const unique = [];
  const seen = new Set();
  for (const item of items || []) {
    const from = String(item?.from || "").trim();
    const to = String(item?.to || "").trim();
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
<<<<<<< HEAD
      return `
        <div class="wordbank-item">
          <div class="wordbank-old">${safeFrom}</div>
          <div class="wordbank-new">${safeTo}</div>
        </div>
      `;
=======
      return `<div class="wordbank-item"><div class="wordbank-old">${safeFrom}</div><div class="wordbank-new">${safeTo}</div></div>`;
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
    })
    .join("");
  wordBankList.innerHTML = html || '<p class="wordbank-empty">No saved words yet.</p>';
}

async function loadWordBank() {
  const base = getApiBase();
  try {
    const res = await fetch(`${base}/api/word-bank?limit=30`);
    const data = await res.json().catch(() => ({}));
<<<<<<< HEAD
    if (!res.ok) {
      renderWordBank([]);
      return;
    }
=======
    if (!res.ok) return renderWordBank([]);
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
    renderWordBank(Array.isArray(data.items) ? data.items : []);
  } catch (_) {
    renderWordBank([]);
  }
}

async function runFeedback() {
  const text = draft.value.trim();
<<<<<<< HEAD
  if (!text) {
    statusLine.textContent = "Add some text first.";
    return;
  }
=======
  if (!text) return (statusLine.textContent = "Add some text first.");
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
  const focus = selectedFocus();
  if (focus.length === 0) {
    statusLine.textContent = "Pick at least one focus: vocabulary, tone, or clarity.";
    return;
  }

  const base = getApiBase();
  submitBtn.disabled = true;
  statusLine.textContent = "Calling Groq…";
  output.textContent = "";
  output.classList.remove("is-error");
  outputMeta.textContent = "";

  try {
    const res = await fetch(`${base}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, focus }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      output.classList.add("is-error");
      output.textContent = data.error || `Request failed (${res.status}).`;
<<<<<<< HEAD
      outputMeta.textContent = "";
      statusLine.textContent = "Error";
      return;
    }
    output.classList.remove("is-error");
=======
      statusLine.textContent = "Error";
      return;
    }
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
    output.textContent = data.feedback || "";
    const metaParts = [];
    if (data.model) metaParts.push(`Model: ${data.model}`);
    if (typeof data.vocabulary_pairs_saved === "number" && data.vocabulary_pairs_saved > 0) {
<<<<<<< HEAD
      metaParts.push(`Saved ${data.vocabulary_pairs_saved} vocab pair(s) to local DB`);
=======
      metaParts.push(`Saved ${data.vocabulary_pairs_saved} vocab pair(s)`);
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
    }
    outputMeta.textContent = metaParts.join(" · ");
    statusLine.textContent = "Done";
    await loadWordBank();
  } catch (e) {
    output.classList.add("is-error");
    output.textContent =
      (e && e.message) ||
      "Could not reach local API at http://127.0.0.1:5050. Start `python app.py` in prototypes/ishika/server.";
<<<<<<< HEAD
    outputMeta.textContent = "";
=======
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
    statusLine.textContent = "Network error";
  } finally {
    submitBtn.disabled = false;
  }
}

function setActiveTab(tabName) {
  const feedbackActive = tabName === "feedback";
  tabFeedback.classList.toggle("is-active", feedbackActive);
  tabWordBank.classList.toggle("is-active", !feedbackActive);
  tabFeedback.setAttribute("aria-selected", feedbackActive ? "true" : "false");
  tabWordBank.setAttribute("aria-selected", feedbackActive ? "false" : "true");
<<<<<<< HEAD

=======
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
  panelFeedback.classList.toggle("is-active", feedbackActive);
  panelWordBank.classList.toggle("is-active", !feedbackActive);
  panelFeedback.hidden = !feedbackActive;
  panelWordBank.hidden = feedbackActive;
}

async function init() {
  setActiveTab("feedback");
<<<<<<< HEAD
  const base = getApiBase();
  syncHomeLinkHref(base);
  await loadWordBank();
=======
  syncHomeLinkHref(getApiBase());
  await loadWordBank();
  hydrateLiveSettings();
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755
}

submitBtn.addEventListener("click", runFeedback);
tabFeedback.addEventListener("click", () => setActiveTab("feedback"));
tabWordBank.addEventListener("click", async () => {
  setActiveTab("wordbank");
  await loadWordBank();
});
<<<<<<< HEAD
=======
document.querySelectorAll('input[name="focus"]').forEach((el) => el.addEventListener("change", persistLiveSettings));
docsLiveEnabled?.addEventListener("change", persistLiveSettings);
docsLiveUseMcp?.addEventListener("change", persistLiveSettings);

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.liveDocsFeedback && docsLiveOutput) {
      docsLiveOutput.textContent = changes.liveDocsFeedback.newValue || "";
    }
    if (changes.liveDocsStatus || changes.liveDocsUpdatedAt) {
      const statusText = changes.liveDocsStatus?.newValue;
      const updatedAt = changes.liveDocsUpdatedAt?.newValue;
      chrome.storage.local.get({ liveDocsStatus: "", liveDocsUpdatedAt: 0 }, (state) => {
        renderLiveStatus(statusText ?? state.liveDocsStatus, updatedAt ?? state.liveDocsUpdatedAt);
      });
    }
  });
}
>>>>>>> c467aba17c05e09ddf44dedfd50bc89b85090755

init();
