(function () {
  var SESSION_KEY = "miranda-writeup-session-v1";

  var PROMPTS = [
    "Explain a technical tradeoff you faced on a recent project: what you optimized for, what you sacrificed, and what evidence would change your mind.",
    "Write a concise incident-style note: what went wrong, what you did to mitigate it, and one follow-up to prevent recurrence.",
    "Describe how you would explain a core idea from your field (an algorithm, protocol, or system design pattern) to a teammate who is new to the codebase.",
    "Draft a short message to a product partner pushing back on scope with clear technical reasoning while keeping the tone collaborative.",
    "Propose a bounded service you would extract from a larger system: what it owns, what it must not own, and how you would phase the split.",
    "Write reproduction steps for a subtle bug: environment, inputs, expected behavior, and actual behavior—so another engineer can pick it up cold.",
    "Summarize the risks of shipping a minimal hotfix under time pressure, and how you would communicate those risks to a lead or manager in plain language.",
    "Argue for a testing mix (unit, integration, end-to-end) for a new HTTP API: where each layer pays off and where it would be wasted effort.",
  ];

  var TOTAL_SEC = 15 * 60;
  var WARN_THRESHOLD_SEC = 120;

  var promptEl = document.getElementById("prompt-text");
  var readyBtn = document.getElementById("ready-btn");
  var submitBtn = document.getElementById("submit-btn");
  var writeRegion = document.getElementById("write-region");
  var draftEl = document.getElementById("draft");
  var timerEl = document.getElementById("timer");
  var statusEl = document.getElementById("session-status");

  var startedAt = null;
  var tickId = null;
  var currentPrompt = "";

  function randomPrompt() {
    return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  }

  function formatClock(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function remainingSeconds() {
    if (startedAt === null) return 0;
    var elapsed = Math.floor((Date.now() - startedAt) / 1000);
    return Math.max(0, TOTAL_SEC - elapsed);
  }

  function setTimerVisual(secondsLeft) {
    timerEl.textContent = formatClock(secondsLeft);
    timerEl.classList.toggle("timer-pill--warn", secondsLeft > 0 && secondsLeft <= WARN_THRESHOLD_SEC);
    timerEl.classList.toggle("timer-pill--done", secondsLeft === 0 && startedAt !== null);
    var label =
      startedAt === null
        ? "Timer not started. Session length is 15 minutes."
        : secondsLeft === 0
          ? "Time is up."
          : "Time remaining: " + formatClock(secondsLeft) + ".";
    timerEl.setAttribute("aria-label", label);
  }

  function persistAndRedirect(source) {
    var payload = {
      version: 1,
      prompt: currentPrompt,
      draft: draftEl.value,
      source: source,
      secondsRemaining: source === "submit" ? remainingSeconds() : 0,
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch (e) {
      // If storage is full or disabled, still navigate; feedback page will show empty state.
    }
    window.location.href = "feedback.html";
  }

  function stopSession() {
    if (tickId !== null) {
      clearInterval(tickId);
      tickId = null;
    }
    persistAndRedirect("timer");
  }

  function tick() {
    var sec = remainingSeconds();
    setTimerVisual(sec);
    if (sec <= 0) {
      stopSession();
    }
  }

  function startSession() {
    readyBtn.disabled = true;
    readyBtn.textContent = "Started";

    writeRegion.hidden = false;
    submitBtn.disabled = false;
    statusEl.textContent = "Writing in progress. Submit when you are done, or let the timer run out.";

    startedAt = Date.now();
    tickId = window.setInterval(tick, 1000);
    tick();

    draftEl.readOnly = false;
    draftEl.disabled = false;
    draftEl.value = "";
    draftEl.focus();
  }

  currentPrompt = randomPrompt();
  promptEl.textContent = currentPrompt;

  timerEl.textContent = "15:00";
  timerEl.classList.add("timer-pill--idle");
  timerEl.setAttribute("aria-label", "Timer not started. Session length is 15 minutes.");

  readyBtn.addEventListener("click", function () {
    if (readyBtn.disabled) return;
    timerEl.classList.remove("timer-pill--idle");
    startSession();
  });

  submitBtn.addEventListener("click", function () {
    if (submitBtn.disabled || startedAt === null) return;
    submitBtn.disabled = true;
    if (tickId !== null) {
      clearInterval(tickId);
      tickId = null;
    }
    persistAndRedirect("submit");
  });
})();
