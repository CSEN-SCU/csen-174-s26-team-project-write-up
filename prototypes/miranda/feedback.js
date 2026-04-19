(function () {
  var SESSION_KEY = "miranda-writeup-session-v1";
  var LT_MAX_BYTES = 20000;
  var LT_MAX_MATCHES = 40;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function loadSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.version !== 1 || typeof data.draft !== "string" || typeof data.prompt !== "string") {
        return null;
      }
      if (data.source !== "timer" && data.source !== "submit") return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function wordCount(text) {
    var t = text.trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function paragraphCount(text) {
    var t = text.trim();
    if (!t) return 0;
    var blocks = t.split(/\n\s*\n/).map(function (p) {
      return p.trim();
    }).filter(Boolean);
    return blocks.length;
  }

  function sentences(text) {
    var t = text.trim();
    if (!t) return [];
    var parts = t.split(/[.!?]+\s+/).map(function (s) {
      return s.trim();
    }).filter(Boolean);
    return parts.length ? parts : [t];
  }

  function analyze(draft) {
    var words = wordCount(draft);
    var paras = paragraphCount(draft);
    var sents = sentences(draft);
    var lengths = sents.map(function (s) {
      return wordCount(s);
    });
    var longCount = lengths.filter(function (n) {
      return n >= 42;
    }).length;
    var avgLen = lengths.length ? lengths.reduce(function (a, b) { return a + b; }, 0) / lengths.length : 0;

    var observations = [];

    if (words === 0) {
      observations.push(
        "Your draft is empty. That can happen if time ran out before you typed, or if you navigated here by mistake."
      );
    } else if (words < 45) {
      observations.push(
        "This is a short response for a timed exercise. In a real interview, check whether the prompt asked for a minimum depth—and whether you ran out of time or stopped early on purpose."
      );
    }

    if (words > 0 && paras === 1 && words > 140) {
      observations.push(
        "You wrote one long block without paragraph breaks. Readers often scan first; adding logical breaks can make tradeoffs, risks, and next steps easier to follow."
      );
    }

    if (longCount > 0) {
      observations.push(
        "Several sentences are quite long (" +
          longCount +
          " over ~40 words). Long sentences are not “wrong,” but splitting some can sharpen cause→effect and reduce cognitive load for a busy reviewer."
      );
    }

    if (words > 200 && paras >= 2 && longCount === 0) {
      observations.push(
        "You used multiple paragraphs and mostly moderate sentence lengths—good signals for clarity under time pressure."
      );
    }

    if (avgLen > 0 && avgLen < 14 && words > 80) {
      observations.push(
        "Average sentence length is on the shorter side. That often reads as confident and direct—just watch for choppiness if ideas need more connective tissue."
      );
    }

    if (observations.length === 0) {
      observations.push(
        "No strong structural flags from this quick pass. The next step is less about “correctness” and more about whether a reader can act on your reasoning without asking follow-up questions."
      );
    }

    var readingMinutes = words === 0 ? 0 : Math.max(1, Math.round(words / 200));

    return {
      words: words,
      paragraphs: paras,
      sentenceCount: sents.length,
      readingMinutes: readingMinutes,
      observations: observations,
    };
  }

  function formatClock(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function truncateUtf8Bytes(str, maxBytes) {
    var enc = new TextEncoder();
    if (enc.encode(str).length <= maxBytes) {
      return { text: str, truncated: false };
    }
    var lo = 0;
    var hi = str.length;
    while (lo < hi) {
      var mid = Math.floor((lo + hi + 1) / 2);
      if (enc.encode(str.slice(0, mid)).length <= maxBytes) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { text: str.slice(0, lo), truncated: lo < str.length };
  }

  function getLanguageToolApiKey() {
    var k = typeof window !== "undefined" ? window.__LANGUAGE_TOOL_API_KEY__ : "";
    return typeof k === "string" ? k.trim() : "";
  }

  function getLanguageToolUsername() {
    var u = typeof window !== "undefined" ? window.__LANGUAGE_TOOL_USERNAME__ : "";
    return typeof u === "string" ? u.trim() : "";
  }

  function getLanguageToolUrl() {
    return getLanguageToolApiKey().length
      ? "https://api.languagetoolplus.com/v2/check"
      : "https://api.languagetool.org/v2/check";
  }

  function contextSnippetHtml(m) {
    var ctx = m.context || {};
    var t = typeof ctx.text === "string" ? ctx.text : "";
    var o = typeof ctx.offset === "number" ? ctx.offset : 0;
    var len = typeof ctx.length === "number" ? ctx.length : 0;
    o = Math.max(0, Math.min(o, t.length));
    len = Math.max(0, Math.min(len, t.length - o));
    var before = escapeHtml(t.slice(0, o));
    var mid = escapeHtml(t.slice(o, o + len));
    var after = escapeHtml(t.slice(o + len));
    return before + "<mark>" + mid + "</mark>" + after;
  }

  function renderMatchItem(m) {
    var li = document.createElement("li");
    li.className = "lt-match-item";

    var msg = document.createElement("span");
    msg.className = "lt-issue-msg";
    msg.textContent = m.message || "Suggestion";

    var meta = document.createElement("div");
    meta.className = "lt-issue-meta";
    var bits = [];
    if (m.shortMessage) bits.push(m.shortMessage);
    if (m.rule && m.rule.id) bits.push(m.rule.id);
    if (m.rule && m.rule.category && m.rule.category.name) bits.push(m.rule.category.name);
    meta.textContent = bits.join(" · ");

    var ctx = document.createElement("div");
    ctx.className = "lt-issue-context";
    ctx.innerHTML = contextSnippetHtml(m);

    var sug = document.createElement("p");
    sug.className = "lt-suggestions";
    var reps = Array.isArray(m.replacements) ? m.replacements.slice(0, 4) : [];
    var vals = reps.map(function (r) {
      return r && typeof r.value === "string" ? r.value : "";
    }).filter(Boolean);
    if (vals.length) {
      sug.innerHTML = "Possible alternatives: <strong>" + escapeHtml(vals.join(" · ")) + "</strong>";
    } else {
      sug.textContent = "No single replacement suggested—edit using the message above.";
    }

    li.appendChild(msg);
    li.appendChild(meta);
    li.appendChild(ctx);
    li.appendChild(sug);
    return li;
  }

  function initLanguageTool(draft) {
    var panel = $("lt-panel");
    var statusEl = $("lt-status");
    var matchesEl = $("lt-matches");
    var truncNote = $("lt-truncation-note");

    panel.hidden = false;
    matchesEl.innerHTML = "";
    truncNote.hidden = true;
    truncNote.textContent = "";

    if (!draft || !String(draft).trim()) {
      statusEl.className = "lt-status";
      statusEl.textContent =
        "LanguageTool was skipped because there is no draft text to check.";
      return;
    }

    var packed = truncateUtf8Bytes(String(draft), LT_MAX_BYTES);
    var textToCheck = packed.text;
    if (packed.truncated) {
      truncNote.hidden = false;
      truncNote.textContent =
        "Your draft was longer than the public LanguageTool limit (20KB per request). Only the start of your draft was checked.";
    }

    statusEl.className = "lt-status lt-status--loading";
    statusEl.textContent = "Checking grammar and spelling with LanguageTool…";

    var params = new URLSearchParams();
    params.set("text", textToCheck);
    params.set("language", "auto");
    var apiKey = getLanguageToolApiKey();
    var username = getLanguageToolUsername();
    if (username.length) {
      params.set("username", username);
    }
    if (apiKey.length) {
      params.set("apiKey", apiKey);
    }

    fetch(getLanguageToolUrl(), {
      method: "POST",
      body: params,
      headers: { Accept: "application/json" },
      credentials: "omit",
    })
      .then(function (res) {
        if (res.status === 429) {
          throw new Error("LanguageTool rate limit reached. Wait a minute and reload this page.");
        }
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error(t.slice(0, 280) || res.statusText);
          });
        }
        return res.json();
      })
      .then(function (data) {
        var matches = Array.isArray(data.matches) ? data.matches : [];
        statusEl.className = "lt-status";

        if (matches.length === 0) {
          statusEl.textContent =
            "LanguageTool did not flag obvious grammar or spelling issues in the checked text. You can still revise for clarity, structure, and argument.";
          return;
        }

        var shown = matches.slice(0, LT_MAX_MATCHES);
        statusEl.textContent =
          "LanguageTool flagged " +
          String(matches.length) +
          " item" +
          (matches.length === 1 ? "" : "s") +
          " in the checked text. Showing " +
          String(shown.length) +
          (matches.length > shown.length ? " (first " + String(shown.length) + ")" : "") +
          ".";

        shown.forEach(function (m) {
          matchesEl.appendChild(renderMatchItem(m));
        });

        if (matches.length > shown.length) {
          var more = document.createElement("li");
          more.className = "lt-match-item";
          more.textContent =
            "…and " +
            String(matches.length - shown.length) +
            " more. Skim your draft below and decide which edits are worth making.";
          matchesEl.appendChild(more);
        }
      })
      .catch(function (err) {
        statusEl.className = "lt-status lt-status--error";
        statusEl.textContent =
          "LanguageTool request failed. Check your network, any ad blockers, or your Premium API key in languagetool-config.js. Details: " +
          (err && err.message ? err.message : String(err));
      });
  }

  function render(session) {
    $("empty-state").hidden = true;
    $("main-content").hidden = false;

    var summary = $("session-summary");
    if (session.source === "timer") {
      summary.textContent =
        "The timer reached zero, so you were sent here automatically with what you had in the text box.";
    } else {
      summary.textContent =
        "You submitted early with " +
        formatClock(Number(session.secondsRemaining) || 0) +
        " left on the clock.";
    }

    $("prompt-display").textContent = session.prompt;

    var stats = analyze(session.draft);
    $("stat-words").textContent = String(stats.words);
    $("stat-paragraphs").textContent = String(stats.paragraphs);
    $("stat-sentences").textContent = String(stats.sentenceCount);
    $("stat-reading").textContent =
      stats.words === 0 ? "—" : "~" + String(stats.readingMinutes) + " min read";

    var obsList = $("observations-list");
    obsList.innerHTML = "";
    stats.observations.forEach(function (item) {
      var li = document.createElement("li");
      li.textContent = item;
      obsList.appendChild(li);
    });

    $("draft-block").innerHTML =
      "<pre class=\"draft-pre\" tabindex=\"0\">" + escapeHtml(session.draft || "") + "</pre>";

    initLanguageTool(session.draft || "");
  }

  function showEmpty() {
    $("empty-state").hidden = false;
    $("main-content").hidden = true;
  }

  var session = loadSession();
  if (!session) {
    showEmpty();
  } else {
    render(session);
  }
})();
