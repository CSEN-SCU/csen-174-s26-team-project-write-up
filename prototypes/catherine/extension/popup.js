const $ = (id) => document.getElementById(id);

const SKIP_INTRO_KEY = "writeupCatherineSkipIntroPopup";

const GOAL_IDS = ["vocabulary", "pedagogy", "patterns", "practice"];

function showView(which) {
  const map = {
    intro: "wuIntro",
    main: "wuMain",
    settings: "wuSettings",
    onboarding: "wuOnboarding",
  };
  for (const [name, id] of Object.entries(map)) {
    const el = $(id);
    if (el) el.hidden = name !== which;
  }
}

async function showIntroView() {
  showView("intro");
  try {
    const data = await chrome.storage.local.get(SKIP_INTRO_KEY);
    $("introSkipNext").checked = Boolean(data[SKIP_INTRO_KEY]);
  } catch {
    $("introSkipNext").checked = false;
  }
}

function showMainView() {
  showView("main");
  void loadMainForm();
}

async function loadMainForm() {
  const ta = $("pieceContext");
  if (!ta) return;
  try {
    const { pieceContext } = await chrome.storage.sync.get("pieceContext");
    ta.value = String(pieceContext || "");
  } catch {
    ta.value = "";
  }
}

async function persistPieceContext() {
  const ta = $("pieceContext");
  if (!ta) return;
  const v = ta.value.trim().slice(0, 400);
  await chrome.storage.sync.set({ pieceContext: v });
}

async function applyIntroPreference() {
  try {
    const data = await chrome.storage.local.get(SKIP_INTRO_KEY);
    if (data[SKIP_INTRO_KEY]) showMainView();
    else await showIntroView();
  } catch {
    await showIntroView();
  }
}

async function loadSettings() {
  const sync = await chrome.storage.sync.get(["apiBase"]);
  const base = $("settingsApiBase");
  if (base) base.value = sync.apiBase || "http://localhost:3847";
}

async function loadOnboardingForm() {
  const sync = await chrome.storage.sync.get(["writingLevel", "writingGoals"]);
  $("obWritingLevel").value = sync.writingLevel || "college";

  const goals = new Set(
    Array.isArray(sync.writingGoals) && sync.writingGoals.length
      ? sync.writingGoals
      : ["vocabulary", "pedagogy"]
  );
  for (const id of GOAL_IDS) {
    const cb = $(`wg-${id}`);
    if (cb) cb.checked = goals.has(id);
  }
}

function setStatus(msg, isError) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("wu-error", Boolean(isError));
}

function setOnboardingStatus(msg, isError) {
  const el = $("onboardingStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("wu-error", Boolean(isError));
}

async function saveSettings() {
  const apiBase =
    $("settingsApiBase").value.trim() || "http://localhost:3847";
  await chrome.storage.sync.set({ apiBase });
  setStatus("Connection saved.");
}

async function saveOnboarding() {
  const writingLevel = $("obWritingLevel").value;
  const writingGoals = GOAL_IDS.filter((id) => $(`wg-${id}`)?.checked);
  const wg =
    writingGoals.length > 0 ? writingGoals : ["vocabulary", "pedagogy"];
  await chrome.storage.sync.set({
    writingLevel,
    writingGoals: wg,
  });
  try {
    await chrome.storage.sync.remove("thesaurusBuckets");
  } catch {
    /* ignore */
  }
  setOnboardingStatus("Goals saved.");
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(type) {
  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("No active tab.", true);
    return;
  }
  if (type === "ANALYZE_SELECTION") {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "POPUP_ANALYZE_SELECTION",
        tabId: tab.id,
      });
      if (res?.ok === false) {
        setStatus(res.error || "Analysis failed.", true);
        return;
      }
      if (res?.outcome === "no_selection") {
        setStatus(
          "No text found. On Google Docs: try again, or copy text (Ctrl+C) and use Analyze clipboard.",
          true
        );
        return;
      }
      if (res?.outcome === "ok") {
        setStatus("Done — check the page for the floating feedback panel.");
        return;
      }
      if (res?.outcome === "api_error") {
        setStatus(
          "API error — see the toast on the page (check server + GROQ_API_KEY).",
          true
        );
        return;
      }
      if (res?.outcome === "script_error" || res?.outcome === "panel_error") {
        setStatus(
          "Could not inject on this page — refresh the tab and try again.",
          true
        );
        return;
      }
      setStatus(
        "Check the page for a toast or panel. If nothing appears, refresh the tab.",
        true
      );
    } catch {
      setStatus(
        "Could not start analysis. Refresh the tab or reload the extension.",
        true
      );
    }
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
    setStatus("Sent to page — check the floating panel.");
  } catch {
    setStatus(
      "Could not reach this page. Try a normal webpage or refresh the tab.",
      true
    );
  }
}

async function fetchProfile() {
  const { userId } = await chrome.storage.local.get("userId");
  const { apiBase } = await chrome.storage.sync.get("apiBase");
  const base = (apiBase || "http://localhost:3847").replace(/\/$/, "");
  const url = `${base}/api/profile/${encodeURIComponent(userId || "")}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.profile || [];
}

function renderProfile(items) {
  const ul = $("profileList");
  ul.innerHTML = "";
  if (!items.length) {
    ul.innerHTML =
      "<li>No history yet — run an analysis to build persistence.</li>";
  } else {
    for (const row of items) {
      const li = document.createElement("li");
      li.textContent = `${row.term} · ${row.count}× (last ${row.lastSeen})`;
      ul.appendChild(li);
    }
  }
  $("profileSection").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings().catch(() => {});
  applyIntroPreference();

  $("btnIntroContinue").addEventListener("click", async () => {
    try {
      if ($("introSkipNext").checked) {
        await chrome.storage.local.set({ [SKIP_INTRO_KEY]: true });
      } else {
        await chrome.storage.local.remove(SKIP_INTRO_KEY);
      }
    } catch {
      /* still show main */
    }
    showMainView();
    $("btnAnalyzeSelection").focus();
  });

  $("btnTabIntro").addEventListener("click", () => {
    void showIntroView();
  });

  $("btnTabSettings").addEventListener("click", () => {
    loadSettings()
      .then(() => {
        showView("settings");
        setStatus("");
      })
      .catch(() => {});
  });

  $("btnTabOnboarding").addEventListener("click", () => {
    loadOnboardingForm()
      .then(() => {
        showView("onboarding");
        setOnboardingStatus("");
      })
      .catch(() => {});
  });

  $("btnSettingsBack").addEventListener("click", () => {
    showMainView();
  });

  $("btnOnboardingBack").addEventListener("click", () => {
    showMainView();
  });

  $("btnSaveSettings").addEventListener("click", () => {
    saveSettings().catch((e) => setStatus(String(e.message || e), true));
  });

  $("btnSaveOnboarding").addEventListener("click", () => {
    saveOnboarding().catch((e) =>
      setOnboardingStatus(String(e.message || e), true)
    );
  });

  $("btnAnalyzeSelection").addEventListener("click", () => {
    persistPieceContext()
      .then(() => sendToContent("ANALYZE_SELECTION"))
      .catch((e) => setStatus(String(e.message || e), true));
  });

  $("btnAnalyzeClipboard").addEventListener("click", () => {
    (async () => {
      await persistPieceContext();
      const tab = await activeTab();
      if (!tab?.id) {
        setStatus("No active tab.", true);
        return;
      }
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        setStatus(
          "Could not read clipboard — allow clipboard permission for this extension.",
          true
        );
        return;
      }
      const trimmed = (text || "").trim();
      if (!trimmed) {
        setStatus("Clipboard is empty — copy some text first (Ctrl+C).", true);
        return;
      }
      try {
        const res = await chrome.runtime.sendMessage({
          type: "POPUP_ANALYZE_TEXT",
          tabId: tab.id,
          text: trimmed,
        });
        if (res?.ok === false) {
          setStatus(res.error || "Analysis failed.", true);
          return;
        }
        if (res?.outcome === "ok") {
          setStatus("Done — check the page for the floating feedback panel.");
          return;
        }
        setStatus("Check the page for a toast or error.", true);
      } catch {
        setStatus("Could not analyze clipboard.", true);
      }
    })().catch((e) => setStatus(String(e.message || e), true));
  });

  $("btnRefreshProfile").addEventListener("click", () => {
    fetchProfile()
      .then((p) => {
        renderProfile(p);
        setStatus("Profile loaded.");
      })
      .catch((e) => setStatus(String(e.message || e), true));
  });

  let pieceDebounce;
  $("pieceContext")?.addEventListener("input", () => {
    clearTimeout(pieceDebounce);
    pieceDebounce = setTimeout(() => {
      persistPieceContext().catch(() => {});
    }, 650);
  });
});
