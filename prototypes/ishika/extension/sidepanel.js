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

function getApiBase() {
  return DEFAULT_API_BASE;
}

/** Landing page is served at the Flask app root (same origin as the API). */
function landingPageUrl(apiBase) {
  const base = (apiBase || DEFAULT_API_BASE).trim().replace(/\/$/, "");
  return `${base || DEFAULT_API_BASE}/`;
}

function syncHomeLinkHref(apiBase) {
  if (homeLink) {
    homeLink.href = landingPageUrl(apiBase);
  }
}

function selectedFocus() {
  return Array.from(document.querySelectorAll('input[name="focus"]:checked')).map((el) => el.value);
}

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
      return `
        <div class="wordbank-item">
          <div class="wordbank-old">${safeFrom}</div>
          <div class="wordbank-new">${safeTo}</div>
        </div>
      `;
    })
    .join("");
  wordBankList.innerHTML = html || '<p class="wordbank-empty">No saved words yet.</p>';
}

async function loadWordBank() {
  const base = getApiBase();
  try {
    const res = await fetch(`${base}/api/word-bank?limit=30`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      renderWordBank([]);
      return;
    }
    renderWordBank(Array.isArray(data.items) ? data.items : []);
  } catch (_) {
    renderWordBank([]);
  }
}

async function runFeedback() {
  const text = draft.value.trim();
  if (!text) {
    statusLine.textContent = "Add some text first.";
    return;
  }
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
      outputMeta.textContent = "";
      statusLine.textContent = "Error";
      return;
    }
    output.classList.remove("is-error");
    output.textContent = data.feedback || "";
    const metaParts = [];
    if (data.model) metaParts.push(`Model: ${data.model}`);
    if (typeof data.vocabulary_pairs_saved === "number" && data.vocabulary_pairs_saved > 0) {
      metaParts.push(`Saved ${data.vocabulary_pairs_saved} vocab pair(s) to local DB`);
    }
    outputMeta.textContent = metaParts.join(" · ");
    statusLine.textContent = "Done";
    await loadWordBank();
  } catch (e) {
    output.classList.add("is-error");
    output.textContent =
      (e && e.message) ||
      "Could not reach local API at http://127.0.0.1:5050. Start `python app.py` in prototypes/ishika/server.";
    outputMeta.textContent = "";
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

  panelFeedback.classList.toggle("is-active", feedbackActive);
  panelWordBank.classList.toggle("is-active", !feedbackActive);
  panelFeedback.hidden = !feedbackActive;
  panelWordBank.hidden = feedbackActive;
}

async function init() {
  setActiveTab("feedback");
  const base = getApiBase();
  syncHomeLinkHref(base);
  await loadWordBank();
}

submitBtn.addEventListener("click", runFeedback);
tabFeedback.addEventListener("click", () => setActiveTab("feedback"));
tabWordBank.addEventListener("click", async () => {
  setActiveTab("wordbank");
  await loadWordBank();
});

init();
