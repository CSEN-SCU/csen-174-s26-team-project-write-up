export const api = {
  me: () => fetch("/api/users/me").then((r) => r.json()),
  history: (docId) => fetch(`/api/feedback-history?docId=${docId ?? ""}`).then((r) => r.json()),
  coach: (text, userId) =>
    fetch("/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, userId, surface: "web" })
    }).then((r) => r.json())
};
