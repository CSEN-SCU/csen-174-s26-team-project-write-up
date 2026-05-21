import "./load-env.js";
import express from "express";
import { loadKnowledge } from "./rag/index.js";
import { applyDismiss } from "./profile/index.js";
import { runCoach } from "./coach/run-coach.js";
import {
  assertCoachingInternalSecretConfigured,
  requireCoachingInternalSecret,
} from "./middleware/internal-secret.js";

const internalSecret = assertCoachingInternalSecretConfigured();

const app = express();
app.use(express.json({ limit: "512kb" }));

app.get("/", (_req, res) => res.json({ ok: true, service: "coaching-api" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(requireCoachingInternalSecret(internalSecret));

app.post("/coach", async (req, res) => {
  try {
    const result = await runCoach(req.body || {});
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result.payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/dismiss", async (req, res) => {
  try {
    const { userId = "anonymous", ...rest } = req.body || {};
    const profileSnapshot = await applyDismiss(userId, rest);
    res.json({ ok: true, profileSnapshot });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

await loadKnowledge().catch((e) => console.error("Failed to load RAG corpus:", e));

app.listen(8787, "127.0.0.1", () =>
  console.log("coaching-api on http://127.0.0.1:8787"),
);
