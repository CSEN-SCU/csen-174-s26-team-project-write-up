const API_URL = "http://127.0.0.1:8765/api/generate";
const CLIENT_BUILD = "popup-err-2";

const promptEl = document.getElementById("prompt");
const outEl = document.getElementById("output");
const btnEl = document.getElementById("send");

btnEl.addEventListener("click", async () => {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    outEl.textContent = "Enter a prompt first.";
    return;
  }

  btnEl.disabled = true;
  outEl.textContent = "Thinking…";

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const rawText = await res.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      const serverMsg =
        (data && typeof data === "object" && (data.error || data.details)
          ? [data.error, data.details].filter(Boolean).join("\n\n")
          : "") ||
        rawText ||
        res.statusText ||
        "Request failed";
      throw new Error(`HTTP ${res.status} ${res.statusText}\n\n${serverMsg}`);
    }

    outEl.textContent =
      (data && typeof data === "object" && data.text) || rawText || "";
  } catch (err) {
    outEl.textContent =
      `[${CLIENT_BUILD}]\n` +
      String(err.message || err) +
      "\n\nStart the Cole API (e.g. py api.py or py groqapi.py from prototypes/cole).";
  } finally {
    btnEl.disabled = false;
  }
});
