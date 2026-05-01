import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { loadKnowledge, getChunkCount, hasSpellAugment } from "./rag/index.js";
import { applyDismiss, loadProfile, summarizeProfile } from "./profile/index.js";
import { runCoach } from "./coach/run-coach.js";
import { resolveCoachLlmAttempts } from "./llm/index.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

app.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Write Up coaching-api</title></head>
<body>
  <p><strong>coaching-api</strong> is running. There is no web UI on this port.</p>
  <ul>
    <li><a href="/health">GET /health</a> — status, RAG chunk count, LLM config</li>
    <li>POST /coach — JSON body: <code>{"text":"...","userId":"optional"}</code></li>
    <li>POST /dismiss — optional feedback dismiss events</li>
    <li>GET /profile/:userId — stored coaching profile</li>
  </ul>
</body>
</html>`);
});

app.get("/health", (_req, res) => {
  const attempts = resolveCoachLlmAttempts();
  res.json({
    ok: true,
    service: "coaching-api",
    chunks: getChunkCount(),
    hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
    hasGroq: Boolean(process.env.GROQ_API_KEY),
    coachLlm: String(process.env.COACH_LLM || "auto").toLowerCase(),
    coachLlmOrder: attempts.map((a) => a.id),
    hasCoachLlm: attempts.length > 0,
    ragTopK: Math.max(1, Math.min(24, Number(process.env.RAG_TOP_K || 8))),
    spellchecker: hasSpellAugment(),
  });
});

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

app.get("/profile/:userId", async (req, res) => {
  try {
    const row = await loadProfile(req.params.userId);
    if (!row) {
      return res.json({ userId: req.params.userId, profileSnapshot: null, notes: [] });
    }
    res.json({
      userId: req.params.userId,
      profileSnapshot: summarizeProfile(row.profile),
      notes: row.notes,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

const port = Number(process.env.PORT || 8787);

await loadKnowledge().catch((e) => {
  console.error("Failed to load RAG corpus:", e);
});

app.listen(port, () => console.log(`coaching-api on http://localhost:${port}`));
