(() => {
  const PANEL_CLASS = "writeup-catherine-panel";
  const THESAURUS_KEY = "writeupCatherineThesaurus";
  const STARRED_KEY = "writeupCatherineStarred";
  const GRAMMAR_DICT_KEY = "writeupCatherineGrammarDict";
  const MAX_THESAURUS = 400;
  const MAX_GRAMMAR = 200;

  /** Old installs: entries keyed only by writing-type buckets. */
  const LEGACY_BUCKET_LABELS = {
    vocabulary: "Earlier saves · Vocabulary & diction",
    tone: "Earlier saves · Tone & audience",
    clarity: "Earlier saves · Clarity & precision",
    formal: "Earlier saves · Academic / workplace",
  };

  /** Stable grouping key for an entry (piece text or legacy sentinel). */
  function pieceStorageKey(e) {
    if (e != null && Object.prototype.hasOwnProperty.call(e, "pieceContext")) {
      return String(e.pieceContext ?? "").trim().slice(0, 400);
    }
    const leg = String(e.categoryId || "vocabulary").trim() || "vocabulary";
    return `__legacy:${leg}`;
  }

  function pieceGroupTitle(key) {
    if (String(key).startsWith("__legacy:")) {
      const id = String(key).slice("__legacy:".length);
      return LEGACY_BUCKET_LABELS[id] || `Earlier saves (${id})`;
    }
    if (!key) return "General (no “This piece is…”)";
    return key;
  }

  function comparePieceGroupKeys(a, b) {
    const leg = (x) => String(x).startsWith("__legacy:");
    if (leg(a) !== leg(b)) return leg(a) ? 1 : -1;
    if (a === "") return -1;
    if (b === "") return 1;
    return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
  }

  let lastHighlightEl = null;
  let highlightStyleEl = null;

  function injectHighlightStyle() {
    if (highlightStyleEl) return;
    highlightStyleEl = document.createElement("style");
    highlightStyleEl.textContent = `
      ::highlight(writeup-weak) {
        background: rgba(212, 165, 116, 0.42);
        text-decoration: underline dotted rgba(180, 130, 80, 0.95);
      }
      ::highlight(writeup-grammar) {
        background: rgba(217, 148, 184, 0.4);
        text-decoration: underline wavy rgba(190, 100, 140, 0.92);
      }
      ::highlight(writeup-spell) {
        background: rgba(110, 201, 168, 0.38);
        text-decoration: underline wavy rgba(55, 160, 130, 0.9);
      }
    `;
    document.documentElement.appendChild(highlightStyleEl);
  }

  function clearHighlights() {
    try {
      if (window.CSS && CSS.highlights) {
        CSS.highlights.delete("writeup-weak");
        CSS.highlights.delete("writeup-grammar");
        CSS.highlights.delete("writeup-spell");
      }
    } catch {
      /* ignore */
    }
    if (lastHighlightEl) {
      lastHighlightEl.classList.remove("writeup-catherine-target");
      lastHighlightEl = null;
    }
  }

  function ensureTextNode(el) {
    if (el.childNodes.length === 0) {
      el.appendChild(document.createTextNode(""));
    }
    let node = el.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      const t = document.createTextNode(el.value || "");
      el.textContent = "";
      el.appendChild(t);
      node = t;
    }
    return node;
  }

  function rangesForSpans(textNode, value, spans) {
    const ranges = [];
    for (const it of spans) {
      if (!Number.isInteger(it.start) || !Number.isInteger(it.end)) continue;
      if (it.start < 0 || it.end > value.length || it.start >= it.end) continue;
      const r = new Range();
      r.setStart(textNode, it.start);
      r.setEnd(textNode, it.end);
      ranges.push(r);
    }
    return ranges;
  }

  function applyHighlights(el, fullText, items, spellingItems, grammarItems) {
    clearHighlights();
    if (!window.CSS || !CSS.highlights) return;
    if (!el || el.tagName !== "TEXTAREA") return;
    const value = el.value;
    if (value !== fullText) return;

    injectHighlightStyle();
    const textNode = ensureTextNode(el);
    if (textNode.nodeValue !== value) {
      textNode.nodeValue = value;
    }

    const vocabRanges = rangesForSpans(textNode, value, items || []);
    const spellRanges = rangesForSpans(textNode, value, spellingItems || []);
    const gramRanges = rangesForSpans(textNode, value, grammarItems || []);
    if (!vocabRanges.length && !spellRanges.length && !gramRanges.length) return;

    if (vocabRanges.length) {
      CSS.highlights.set("writeup-weak", new Highlight(...vocabRanges));
    }
    if (spellRanges.length) {
      CSS.highlights.set("writeup-spell", new Highlight(...spellRanges));
    }
    if (gramRanges.length) {
      CSS.highlights.set("writeup-grammar", new Highlight(...gramRanges));
    }
    el.classList.add("writeup-catherine-target");
    lastHighlightEl = el;
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "writeup-catherine-toast";
    t.textContent = msg;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function ensureCatherineFonts() {
    if (document.getElementById("writeup-catherine-fonts")) return;
    const link = document.createElement("link");
    link.id = "writeup-catherine-fonts";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&display=swap";
    document.head.appendChild(link);
  }

  function ensurePanel() {
    let panel = document.querySelector(`.${PANEL_CLASS}`);
    if (!panel) {
      ensureCatherineFonts();
      panel = document.createElement("section");
      panel.className = PANEL_CLASS;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Write Up feedback");
      document.documentElement.appendChild(panel);
    }
    if (!panel.dataset.wuLexBound) {
      panel.dataset.wuLexBound = "1";
      panel.addEventListener("click", onPanelLexiconClick);
    }
    return panel;
  }

  async function loadLexicon() {
    const r = await chrome.storage.local.get([
      THESAURUS_KEY,
      STARRED_KEY,
      GRAMMAR_DICT_KEY,
    ]);
    return {
      thesaurus: Array.isArray(r[THESAURUS_KEY]) ? r[THESAURUS_KEY] : [],
      starred: Array.isArray(r[STARRED_KEY]) ? r[STARRED_KEY] : [],
      grammar: Array.isArray(r[GRAMMAR_DICT_KEY]) ? r[GRAMMAR_DICT_KEY] : [],
    };
  }

  async function addGrammarRule(wrong, right, note, ruleLabel) {
    const w = String(wrong || "").trim();
    const r = String(right || "").trim();
    const n = String(note || "").trim();
    const rule = String(ruleLabel || "").trim().slice(0, 220);
    if (!w && !r) return;
    const lw = w.toLowerCase();
    const { [GRAMMAR_DICT_KEY]: list = [] } = await chrome.storage.local.get(
      GRAMMAR_DICT_KEY
    );
    if (list.some((e) => String(e.wrong || "").trim().toLowerCase() === lw)) {
      toast("That pattern is already in your grammar list");
      return;
    }
    const next = [
      {
        wrong: w,
        right: r,
        note: n,
        rule,
        savedAt: new Date().toISOString(),
      },
      ...list,
    ].slice(0, MAX_GRAMMAR);
    await chrome.storage.local.set({ [GRAMMAR_DICT_KEY]: next });
    toast("Saved grammar rule");
  }

  async function removeGrammarRule(wrong) {
    const lw = String(wrong || "")
      .trim()
      .toLowerCase();
    const { [GRAMMAR_DICT_KEY]: list = [] } = await chrome.storage.local.get(
      GRAMMAR_DICT_KEY
    );
    const next = list.filter(
      (e) => String(e.wrong || "").trim().toLowerCase() !== lw
    );
    await chrome.storage.local.set({ [GRAMMAR_DICT_KEY]: next });
    toast("Removed grammar rule");
  }

  function isStarred(starred, word, kind) {
    const lw = String(word || "")
      .trim()
      .toLowerCase();
    const k = kind || "flagged";
    return starred.some(
      (e) =>
        String(e.word || "")
          .trim()
          .toLowerCase() === lw && (e.kind || "flagged") === k
    );
  }

  async function addThesaurusWord(word, relatedFlaggedTerm, pieceContextStr) {
    const w = String(word || "").trim();
    if (!w) return;
    const piece = String(pieceContextStr || "").trim().slice(0, 400);
    const { [THESAURUS_KEY]: list = [] } = await chrome.storage.local.get(
      THESAURUS_KEY
    );
    const lw = w.toLowerCase();
    if (
      list.some((e) => {
        const ew = String(e.word || e)
          .trim()
          .toLowerCase();
        return ew === lw && pieceStorageKey(e) === piece;
      })
    ) {
      toast("Already saved for this piece description");
      return;
    }
    const next = [
      {
        word: w,
        relatedFlagged: String(relatedFlaggedTerm || "").trim(),
        pieceContext: piece,
        savedAt: new Date().toISOString(),
      },
      ...list,
    ].slice(0, MAX_THESAURUS);
    await chrome.storage.local.set({ [THESAURUS_KEY]: next });
    const label = piece || "General (no “This piece is…”)";
    toast(`Added “${w}” under “${label.length > 48 ? `${label.slice(0, 48)}…` : label}”`);
  }

  async function toggleStar(word, kind, relatedFlaggedTerm) {
    const w = String(word || "").trim();
    if (!w) return false;
    const k = kind || "flagged";
    const rel = String(relatedFlaggedTerm || "").trim();
    const { [STARRED_KEY]: list = [] } = await chrome.storage.local.get(
      STARRED_KEY
    );
    const lw = w.toLowerCase();
    const idx = list.findIndex(
      (e) =>
        String(e.word || "")
          .trim()
          .toLowerCase() === lw && (e.kind || "flagged") === k
    );
    if (idx >= 0) {
      list.splice(idx, 1);
      await chrome.storage.local.set({ [STARRED_KEY]: list });
      return false;
    }
    list.unshift({
      word: w,
      kind: k,
      relatedFlagged: rel,
      starredAt: new Date().toISOString(),
    });
    await chrome.storage.local.set({
      [STARRED_KEY]: list.slice(0, MAX_THESAURUS),
    });
    return true;
  }

  async function removeThesaurusWord(word, pieceKeyEncoded) {
    const lw = String(word || "")
      .trim()
      .toLowerCase();
    let pieceKey = "";
    try {
      pieceKey = decodeURIComponent(String(pieceKeyEncoded || ""));
    } catch {
      pieceKey = String(pieceKeyEncoded || "");
    }
    const { [THESAURUS_KEY]: list = [] } = await chrome.storage.local.get(
      THESAURUS_KEY
    );
    const next = list.filter((e) => {
      const ew = String(e.word || e)
        .trim()
        .toLowerCase();
      if (ew !== lw) return true;
      return pieceStorageKey(e) !== pieceKey;
    });
    await chrome.storage.local.set({ [THESAURUS_KEY]: next });
    toast("Removed from thesaurus");
  }

  async function removeStarEntry(word, kind) {
    const lw = String(word || "")
      .trim()
      .toLowerCase();
    const k = kind || "flagged";
    const { [STARRED_KEY]: list = [] } = await chrome.storage.local.get(
      STARRED_KEY
    );
    const next = list.filter(
      (e) =>
        !(
          String(e.word || "")
            .trim()
            .toLowerCase() === lw && (e.kind || "flagged") === k
        )
    );
    await chrome.storage.local.set({ [STARRED_KEY]: next });
    toast("Removed from starred");
  }

  async function refreshPersonalSection(panel) {
    const body = panel.querySelector("#writeup-personal-body");
    const countsEl = panel.querySelector("#writeup-notebook-counts");
    if (!body) return;
    const { thesaurus, starred, grammar } = await loadLexicon();
    if (countsEl) {
      countsEl.textContent = `Thesaurus ${thesaurus.length} · Starred ${starred.length} · Grammar rules ${grammar.length}`;
    }

    const escAttr = (s) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");

    const { pieceContext: syncPiece = "" } = await chrome.storage.sync.get(
      "pieceContext"
    );
    const currentPiece = String(syncPiece || "").trim().slice(0, 400);

    const groups = new Map();
    for (const e of thesaurus) {
      const key = pieceStorageKey(e);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    let orderedKeys = [...groups.keys()].sort(comparePieceGroupKeys);
    if (currentPiece && orderedKeys.includes(currentPiece)) {
      orderedKeys = orderedKeys.filter((k) => k !== currentPiece);
      orderedKeys.unshift(currentPiece);
    }

    const pillFor = (e) => {
      const w = String(e.word || e).trim();
      if (!w) return "";
      const pk = pieceStorageKey(e);
      const pkAttr = encodeURIComponent(pk);
      const rel = e.relatedFlagged ? ` (for “${escAttr(e.relatedFlagged)}”)` : "";
      return `<span class="writeup-catherine-pill">${escAttr(w)}${rel}<button type="button" class="writeup-catherine-pill-remove" data-action="remove-thesaurus" data-word="${encodeURIComponent(w)}" data-piece-key="${pkAttr}" title="Remove">×</button></span>`;
    };

    let thesHtml = "";
    let shown = 0;
    const maxPills = 48;
    for (const key of orderedKeys) {
      const rows = groups.get(key) || [];
      if (!rows.length) continue;
      const title = pieceGroupTitle(key);
      const room = maxPills - shown;
      if (room <= 0) break;
      const slice = rows.slice(0, room);
      const chunk = slice.map(pillFor).join("");
      shown += slice.length;
      thesHtml += `<div class="writeup-catherine-catgroup"><div class="writeup-catherine-catname">${escAttr(
        title
      )}</div><div class="writeup-catherine-pillrow">${chunk}</div></div>`;
    }
    if (!thesHtml) {
      thesHtml =
        "<span style='opacity:.7'>Empty — set <strong>This piece is…</strong> in the Write Up popup if you want separate lists (e.g. lab vs storyboard), then use ＋ on a synonym.</span>";
    }

    const starPills = starred
      .slice(0, 40)
      .map((e) => {
        const w = String(e.word || "").trim();
        if (!w) return "";
        const tag = e.kind === "synonym" ? "synonym" : "flagged";
        return `<span class="writeup-catherine-pill">★ ${escAttr(w)} <span style="opacity:.65">(${tag})</span><button type="button" class="writeup-catherine-pill-remove" data-action="remove-star" data-word="${encodeURIComponent(w)}" data-kind="${tag}" title="Unstar">×</button></span>`;
      })
      .join(" ");

    const grammarBlocks = grammar
      .slice(0, 30)
      .map((e) => {
        const w = String(e.wrong || "").trim();
        const r = String(e.right || "").trim();
        if (!w) return "";
        const ruleTitle = String(e.rule || "").trim();
        const title = ruleTitle || "Grammar pattern";
        const example = r ? `${escAttr(w)} → ${escAttr(r)}` : escAttr(w);
        const extra = e.note
          ? `<div class="writeup-catherine-grammar-rule-note">${escAttr(
              e.note
            )}</div>`
          : "";
        return `<div class="writeup-catherine-grammar-rule">
            <div class="writeup-catherine-grammar-rule-title">${escAttr(
              title
            )}</div>
            <div class="writeup-catherine-grammar-rule-example">${example}</div>
            ${extra}
            <button type="button" class="writeup-catherine-grammar-rule-remove" data-action="remove-grammar" data-wrong="${encodeURIComponent(w)}" title="Remove this rule">Remove</button>
          </div>`;
      })
      .join("");

    body.innerHTML = `
      <div><strong style="color:#9aa3b2">Thesaurus</strong>${thesHtml}</div>
      <div style="margin-top:10px"><strong style="color:#9aa3b2">Starred</strong><div style="margin-top:4px">${starPills || "<span style='opacity:.7'>Empty — use ☆ on a word.</span>"}</div></div>
      <div style="margin-top:10px"><strong style="color:#9aa3b2">Grammar rules</strong><div class="writeup-catherine-grammar-rules">${grammarBlocks || "<span style='opacity:.7'>Empty — use ＋ Save rule on a grammar card on the Feedback tab.</span>"}</div></div>
    `;
  }

  function initPanelTabs(panel) {
    if (panel.dataset.writeupTabs === "1") return;
    panel.dataset.writeupTabs = "1";
    panel.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (!tab || !panel.contains(tab)) return;
      const id = tab.getAttribute("data-tab");
      if (!id) return;
      panel.querySelectorAll("[data-tab]").forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.classList.toggle("is-active", on);
      });
      panel.querySelectorAll("[data-tabpane]").forEach((p) => {
        const on = p.getAttribute("data-tabpane") === id;
        p.hidden = !on;
        p.classList.toggle("is-active", on);
      });
    });
  }

  async function onPanelLexiconClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const panel = e.currentTarget;

    if (action === "thesaurus") {
      const word = decodeURIComponent(btn.getAttribute("data-word") || "");
      const flagged = decodeURIComponent(btn.getAttribute("data-flagged") || "");
      const sync = await chrome.storage.sync.get("pieceContext");
      const piece = String(sync.pieceContext || "").trim().slice(0, 400);
      await addThesaurusWord(word, flagged, piece);
      btn.classList.add("is-done");
      await refreshPersonalSection(panel);
      return;
    }

    if (action === "star") {
      const word = decodeURIComponent(btn.getAttribute("data-word") || "");
      const kind = btn.getAttribute("data-kind") || "flagged";
      const related = decodeURIComponent(btn.getAttribute("data-related") || "");
      const on = await toggleStar(word, kind, related);
      btn.classList.toggle("is-on", on);
      btn.textContent = on ? "★" : "☆";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      toast(on ? "Starred" : "Unstarred");
      await refreshPersonalSection(panel);
      return;
    }

    if (action === "remove-thesaurus") {
      const word = decodeURIComponent(btn.getAttribute("data-word") || "");
      const pieceKey = btn.getAttribute("data-piece-key") || "";
      await removeThesaurusWord(word, pieceKey);
      await refreshPersonalSection(panel);
      return;
    }

    if (action === "remove-star") {
      const word = decodeURIComponent(btn.getAttribute("data-word") || "");
      const kind = btn.getAttribute("data-kind") || "flagged";
      await removeStarEntry(word, kind);
      await refreshPersonalSection(panel);
      const starBtn = panel.querySelector(
        `[data-action="star"][data-word="${encodeURIComponent(word)}"][data-kind="${kind}"]`
      );
      if (starBtn) {
        starBtn.classList.remove("is-on");
        starBtn.textContent = "☆";
        starBtn.setAttribute("aria-pressed", "false");
      }
      return;
    }

    if (action === "grammar-save") {
      const wrong = decodeURIComponent(btn.getAttribute("data-wrong") || "");
      const right = decodeURIComponent(btn.getAttribute("data-right") || "");
      const rule = decodeURIComponent(btn.getAttribute("data-rule") || "");
      if (!wrong.trim()) return;
      await addGrammarRule(wrong, right, "", rule);
      btn.classList.add("is-done");
      await refreshPersonalSection(panel);
      return;
    }

    if (action === "remove-grammar") {
      const wrong = decodeURIComponent(btn.getAttribute("data-wrong") || "");
      await removeGrammarRule(wrong);
      await refreshPersonalSection(panel);
      return;
    }
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function shortenErr(s) {
    const t = String(s || "");
    if (/429|quota|Too Many Requests|rate.?limit/i.test(t)) {
      return "Groq rate limit — wait and retry, or change GROQ_MODEL in .env.catherine.";
    }
    return t.length > 220 ? `${t.slice(0, 220)}…` : t;
  }

  async function wireThesaurusPieceBanner(panel) {
    const textEl = panel.querySelector("#writeup-piece-banner-text");
    if (!textEl) return;
    const { pieceContext } = await chrome.storage.sync.get("pieceContext");
    const pc = String(pieceContext || "").trim();
    textEl.textContent = pc
      ? pc
      : "General — describe this piece on the Write Up popup (“This piece is…”) so saves group by project (chemistry paper, storyboard, etc.).";
  }

  function setupPanelDrag(panel) {
    const head = panel.querySelector(".writeup-catherine-head");
    if (!head || head.dataset.writeupDrag === "1") return;
    head.dataset.writeupDrag = "1";

    head.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest("button")) return;
      ev.preventDefault();
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";

      const ox = ev.clientX - rect.left;
      const oy = ev.clientY - rect.top;
      head.style.cursor = "grabbing";

      const onMove = (e2) => {
        const w = panel.offsetWidth;
        let nx = e2.clientX - ox;
        let ny = e2.clientY - oy;
        nx = Math.max(6, Math.min(window.innerWidth - w - 6, nx));
        ny = Math.max(6, Math.min(window.innerHeight - 24, ny));
        panel.style.left = `${nx}px`;
        panel.style.top = `${ny}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        head.style.cursor = "grab";
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  async function renderPanel(payload, ctx) {
    if (window !== window.top) return;
    document.querySelectorAll(`.${PANEL_CLASS}`).forEach((n) => n.remove());
    const panel = ensurePanel();
    const {
      items = [],
      grammarItems: rawGrammarItems = [],
      spellingItems: rawSpellingItems = [],
      grammarFlow = "",
      usedAi,
      aiError,
      writingLevel,
      writingGoals: payloadGoals = [],
      pieceContext: pieceCtx = "",
      analysisHint = "",
    } = payload;
    const grammarItems = Array.isArray(rawGrammarItems) ? rawGrammarItems : [];
    const spellingItems = Array.isArray(rawSpellingItems) ? rawSpellingItems : [];
    const errLine = aiError ? shortenErr(aiError) : "";
    const { starred } = await loadLexicon();
    const goalsShort = Array.isArray(payloadGoals)
      ? payloadGoals.join(", ")
      : "";
    const pieceLine = String(pieceCtx || "").trim();
    const flowLine = String(grammarFlow || "").trim();

    const cards = items
      .map((it) => {
        const flaggedStar = isStarred(starred, it.term, "flagged");
        const syns = (it.synonyms || [])
          .map((s) => {
            const syn = String(s).trim();
            if (!syn) return "";
            const synStar = isStarred(starred, syn, "synonym");
            return `<li class="writeup-catherine-syn-li">
              <span class="writeup-catherine-syn-text">${esc(syn)}</span>
              <button type="button" class="writeup-catherine-iconbtn" data-action="thesaurus" data-word="${encodeURIComponent(syn)}" data-flagged="${encodeURIComponent(it.term)}" title="Add to my thesaurus">＋</button>
              <button type="button" class="writeup-catherine-iconbtn ${synStar ? "is-on" : ""}" data-action="star" data-word="${encodeURIComponent(syn)}" data-kind="synonym" data-related="${encodeURIComponent(it.term)}" title="Star this synonym" aria-pressed="${synStar ? "true" : "false"}">${synStar ? "★" : "☆"}</button>
            </li>`;
          })
          .join("");
        const rewrite = it.optionalRewrite
          ? `<p class="writeup-catherine-dl"><strong>Optional rewrite:</strong> ${esc(
              it.optionalRewrite
            )}</p>`
          : "";
        return `
          <article class="writeup-catherine-card">
            <div class="writeup-catherine-termrow">
              <h3 class="writeup-catherine-term">${esc(it.term)}</h3>
              <button type="button" class="writeup-catherine-iconbtn ${flaggedStar ? "is-on" : ""}" data-action="star" data-word="${encodeURIComponent(it.term)}" data-kind="flagged" data-related="" title="Star this flagged word" aria-pressed="${flaggedStar ? "true" : "false"}">${flaggedStar ? "★" : "☆"}</button>
            </div>
            <p class="writeup-catherine-meta">${esc(it.reason || "Vague or overused in this context.")}</p>
            ${
              it.definition
                ? `<p class="writeup-catherine-dl"><strong>Definition:</strong> ${esc(
                    it.definition
                  )}</p>`
                : ""
            }
            ${
              syns
                ? `<div><strong>Synonyms</strong><ul class="writeup-catherine-syns">${syns}</ul></div>`
                : ""
            }
            ${
              it.pedagogicalNote
                ? `<p class="writeup-catherine-dl"><strong>Why it matters:</strong> ${esc(
                    it.pedagogicalNote
                  )}</p>`
                : ""
            }
            ${rewrite}
            <div class="writeup-catherine-actions">
              <button type="button" class="writeup-catherine-btn" data-syns="${encodeURIComponent(
                JSON.stringify(it.synonyms || [])
              )}">Copy all synonyms</button>
            </div>
          </article>
        `;
      })
      .join("");

    const spellingCards = spellingItems
      .map((s) => {
        const term = String(s.term || "").trim();
        if (!term) return "";
        const fix = String(s.fix || "").trim();
        const tip = String(s.flowTip || "").trim();
        const issueLine = String(s.issue || "").trim() || "Spelling";
        return `
          <article class="writeup-catherine-card writeup-catherine-card--spelling">
            <h3 class="writeup-catherine-term">${esc(term)}</h3>
            <p class="writeup-catherine-meta">${esc(issueLine)}</p>
            ${
              fix
                ? `<p class="writeup-catherine-dl"><strong>Suggestion:</strong> ${esc(
                    fix
                  )}</p>`
                : ""
            }
            ${
              tip
                ? `<p class="writeup-catherine-dl"><strong>Note:</strong> ${esc(
                    tip
                  )}</p>`
                : ""
            }
          </article>
        `;
      })
      .join("");

    const grammarCards = grammarItems
      .map((g) => {
        const term = String(g.term || "").trim();
        if (!term) return "";
        const fix = String(g.fix || "").trim();
        const tip = String(g.flowTip || "").trim();
        const issueLine = String(g.issue || "").trim() || "Grammar or flow";
        return `
          <article class="writeup-catherine-card writeup-catherine-card--grammar">
            <h3 class="writeup-catherine-term">${esc(term)}</h3>
            <p class="writeup-catherine-meta">${esc(issueLine)}</p>
            ${
              fix
                ? `<p class="writeup-catherine-dl"><strong>Suggestion:</strong> ${esc(
                    fix
                  )}</p>`
                : ""
            }
            ${
              tip
                ? `<p class="writeup-catherine-dl"><strong>Local flow:</strong> ${esc(
                    tip
                  )}</p>`
                : ""
            }
            <div class="writeup-catherine-actions">
              <button type="button" class="writeup-catherine-btn writeup-catherine-btn--ghost" data-action="grammar-save" data-wrong="${encodeURIComponent(
                term
              )}" data-right="${encodeURIComponent(
                fix
              )}" data-rule="${encodeURIComponent(issueLine)}">＋ Save rule</button>
            </div>
          </article>
        `;
      })
      .join("");

    const hasVocab = Boolean(cards.trim());
    const hasSpell = Boolean(spellingCards.trim());
    const hasGram = Boolean(grammarCards.trim());
    const emptyBoth = !hasVocab && !hasGram && !hasSpell;
    const praiseOnly = emptyBoth;
    const praiseText =
      flowLine ||
      (errLine
        ? `No spelling, vocabulary, or grammar issues returned. (${errLine})`
        : "No spelling, vocabulary, or grammar issues returned for this passage—it reads clearly. Nice work.");
    const flowBannerHtml =
      !praiseOnly && flowLine
        ? `<div class="writeup-catherine-flow"><strong>Flow:</strong> ${esc(
            flowLine
          )}</div>`
        : "";
    const emptyMsg = praiseOnly
      ? `<p class="writeup-catherine-empty writeup-catherine-empty--praise">${esc(
          praiseText
        )}</p>`
      : "";

    panel.innerHTML = `
      <header class="writeup-catherine-head">
        <div>
          <h2 class="writeup-catherine-title">Write Up feedback</h2>
          <p class="writeup-catherine-sub">Level: ${esc(writingLevel)}${
            goalsShort ? ` · Goals: ${esc(goalsShort)}` : ""
          } · AI: ${usedAi ? "on" : "off"}${errLine ? ` · ${esc(errLine)}` : ""}</p>
          ${
            pieceLine
              ? `<p class="writeup-catherine-piecectx"><strong>This piece:</strong> ${esc(
                  pieceLine
                )}</p>`
              : ""
          }
        </div>
        <button type="button" class="writeup-catherine-close" aria-label="Close">✕</button>
      </header>
      <div class="writeup-catherine-body">
        <nav class="writeup-catherine-tabs" role="tablist" aria-label="Panel views">
          <button type="button" class="writeup-catherine-tab is-active" role="tab" aria-selected="true" data-tab="feedback">Feedback</button>
          <button type="button" class="writeup-catherine-tab" role="tab" aria-selected="false" data-tab="notebook">My thesaurus</button>
        </nav>
        <div class="writeup-catherine-tabpanes">
          <div class="writeup-catherine-tabpane is-active" data-tabpane="feedback" role="tabpanel">
        <div class="writeup-catherine-chip">Source: ${esc(ctx.source)} · <span style="opacity:.85">Teal = spelling · Yellow = vocabulary · Pink = grammar</span></div>
        ${
          hasVocab
            ? `<div id="writeup-thes-catbar" class="writeup-catherine-thes-catbar writeup-catherine-piece-banner" aria-live="polite">
          <span class="writeup-catherine-catlabel">Synonyms save under “This piece is…”</span>
          <p id="writeup-piece-banner-text" class="writeup-catherine-piece-banner-text"></p>
        </div>`
            : ""
        }
        ${
          analysisHint
            ? `<p class="writeup-catherine-banner">${esc(analysisHint)}</p>`
            : ""
        }
        ${flowBannerHtml}
        ${
          hasSpell
            ? `<h3 class="writeup-catherine-sectiontitle">Spelling</h3>${spellingCards}`
            : ""
        }
        ${
          hasVocab
            ? `<h3 class="writeup-catherine-sectiontitle">Vocabulary</h3>${cards}`
            : ""
        }
        ${
          hasGram
            ? `<h3 class="writeup-catherine-sectiontitle">Grammar &amp; flow</h3>${grammarCards}`
            : ""
        }
        ${emptyMsg}
          </div>
          <div class="writeup-catherine-tabpane" data-tabpane="notebook" role="tabpanel" hidden>
            <p id="writeup-notebook-counts" class="writeup-catherine-notebook-counts"></p>
            <p class="writeup-catherine-notebook-intro">Saved synonyms (grouped by your <strong>This piece is…</strong> line), starred words, and grammar rules you add from feedback cards.</p>
            <div id="writeup-personal-body" class="writeup-catherine-personal-body"></div>
          </div>
        </div>
      </div>
    `;

    panel
      .querySelector(".writeup-catherine-close")
      .addEventListener("click", () => {
        panel.remove();
        clearHighlights();
      });

    panel.querySelectorAll("[data-syns]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        let list = [];
        try {
          list = JSON.parse(
            decodeURIComponent(btn.getAttribute("data-syns") || "%5B%5D")
          );
        } catch {
          list = [];
        }
        const text = Array.isArray(list) ? list.join(", ") : "";
        try {
          await navigator.clipboard.writeText(text);
          toast("Copied synonyms");
        } catch {
          toast("Could not copy");
        }
      });
    });

    setupPanelDrag(panel);
    initPanelTabs(panel);
    await wireThesaurusPieceBanner(panel);
    await refreshPersonalSection(panel);

    const hasVocabRanges = (items || []).some(
      (it) => Number.isInteger(it.start) && Number.isInteger(it.end)
    );
    const hasSpellRanges = (spellingItems || []).some(
      (s) => Number.isInteger(s.start) && Number.isInteger(s.end)
    );
    const hasGramRanges = (grammarItems || []).some(
      (g) => Number.isInteger(g.start) && Number.isInteger(g.end)
    );
    if (
      ctx.highlightEl &&
      (hasVocabRanges || hasSpellRanges || hasGramRanges)
    ) {
      applyHighlights(
        ctx.highlightEl,
        ctx.fullText,
        items,
        spellingItems,
        grammarItems
      );
    } else {
      clearHighlights();
    }
  }

  function selectionText() {
    return window.getSelection()?.toString() || "";
  }

  function extractGoogleDocsEditorText() {
    try {
      const h = location.hostname || "";
      if (!h.includes("docs.google.com")) return "";
      const ed =
        document.querySelector(".kix-appview-editor") ||
        document.querySelector(".kix-page-content-wrapper") ||
        document.querySelector('[role="textbox"]');
      if (!ed) return "";
      return (ed.innerText || "")
        .replace(/\u200b/g, "")
        .replace(/\u00a0/g, " ")
        .trim()
        .slice(0, 25000);
    } catch {
      return "";
    }
  }

  function getActiveField() {
    const fromDocs = extractGoogleDocsEditorText();
    if (fromDocs) {
      return { text: fromDocs, el: null, acquisition: "google_doc_body" };
    }

    const el = document.activeElement;
    if (!el) return { text: "", el: null, acquisition: "focused_field" };
    const tag = el.tagName;
    if (tag === "TEXTAREA") return { text: el.value, el, acquisition: "focused_field" };
    if (tag === "INPUT") {
      const t = el.type || "text";
      if (["text", "search", "email", "url", ""].includes(t)) {
        return { text: el.value, el, acquisition: "focused_field" };
      }
    }
    if (el.isContentEditable) {
      const txt = el.innerText || "";
      return { text: txt, el, acquisition: "focused_field" };
    }
    return { text: "", el: null, acquisition: "focused_field" };
  }

  async function analyzeText(text, ctx) {
    if (window !== window.top) return;
    const trimmed = text.trim();
    if (!trimmed) {
      toast("Select some text first (works in Google Docs too).");
      return;
    }

    const sync = await chrome.storage.sync.get([
      "apiBase",
      "writingLevel",
      "writingGoals",
      "pieceContext",
    ]);
    const { [GRAMMAR_DICT_KEY]: grammarDictRaw } = await chrome.storage.local.get(
      GRAMMAR_DICT_KEY
    );
    const grammarDictionary = Array.isArray(grammarDictRaw)
      ? grammarDictRaw
          .slice(0, 40)
          .map((e) => ({
            wrong: String(e.wrong || "").trim(),
            right: String(e.right || "").trim(),
            note: String(e.note || "").trim(),
            rule: String(e.rule || "").trim(),
          }))
          .filter((e) => e.wrong || e.right)
      : [];
    const goals = Array.isArray(sync.writingGoals) ? sync.writingGoals : [];
    const pieceContext = String(sync.pieceContext || "").trim().slice(0, 500);
    const payload = {
      text: trimmed,
      writingLevel: sync.writingLevel || "college",
      writingGoals: goals.length ? goals : ["vocabulary", "pedagogy"],
      pieceContext,
      grammarDictionary,
      sourceUrl: location.href,
      apiBase: sync.apiBase || "http://localhost:3847",
      textAcquisition: ctx.textAcquisition || "selection",
    };

    const res = await chrome.runtime.sendMessage({
      type: "ANALYZE_TEXT",
      payload,
    });
    if (!res?.ok) {
      const err = res?.error || "Analysis failed";
      toast(err);
      throw new Error(err);
    }
    await renderPanel(res.data, { ...ctx, fullText: trimmed });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "WRITEUP_TOAST") {
      if (window !== window.top) {
        sendResponse({ ok: true });
        return true;
      }
      toast(msg.message || "");
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "WRITEUP_SHOW_PANEL") {
      if (window !== window.top) {
        sendResponse({ ok: true });
        return true;
      }
      renderPanel(msg.payload, {
        source: msg.ctx?.source || "selection",
        highlightEl: msg.ctx?.highlightEl ?? null,
        fullText: msg.ctx?.fullText || "",
      })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (msg?.type === "ANALYZE_SELECTION") {
      if (window !== window.top) {
        sendResponse({ ok: true });
        return true;
      }
      analyzeText(selectionText(), {
        source: "selection",
        highlightEl: null,
        textAcquisition: "selection",
      })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === "ANALYZE_ACTIVE_FIELD") {
      if (window !== window.top) {
        sendResponse({ ok: true });
        return true;
      }
      const { text, el, acquisition } = getActiveField();
      const canHighlight = el && el.tagName === "TEXTAREA";
      analyzeText(text || "", {
        source: "focused field",
        highlightEl: canHighlight ? el : null,
        textAcquisition: acquisition || "focused_field",
      })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    return false;
  });
})();
