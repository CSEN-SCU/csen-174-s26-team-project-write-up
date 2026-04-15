const API_URL = "http://127.0.0.1:8765/api/generate";

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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || res.statusText || "Request failed");
    }
    outEl.textContent = data.text ?? "";
  } catch (err) {
    outEl.textContent =
      String(err.message || err) +
      "\n\nIs api.py running? (py api.py from prototypes/cole)";
  } finally {
    btnEl.disabled = false;
  }
});
