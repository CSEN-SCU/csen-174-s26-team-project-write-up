import "./load-env.js";
import express from "express";
import { loadKnowledge, getChunkCount, hasSpellAugment } from "./rag/index.js";
import { applyDismiss } from "./profile/index.js";
import { runCoach } from "./coach/run-coach.js";
import { resolveCoachLlmAttempts } from "./llm/index.js";
import { coachLogLlmEnabled, coachLogLlmFullBodies, coachLogLlmPreviewLimit } from "./llm/log.js";
import {
  assertCoachingInternalSecretConfigured,
  requireCoachingInternalSecret,
} from "./middleware/internal-secret.js";
import { coachPostRateLimiter, dismissPostRateLimiter } from "./middleware/coach-rate-limit.js";

const internalSecret = assertCoachingInternalSecretConfigured();

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use(requireCoachingInternalSecret(internalSecret));

app.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Write Up coaching-api</title></head>
<body>
  <p><strong>coaching-api</strong> is running. There is no web UI on this port.</p>
  <p>Every route requires header <code>X-Coaching-Internal-Secret</code> (see <code>COACHING_INTERNAL_SECRET</code> in <code>.env.example</code>).</p>
  <ul>
    <li><code>GET /health</code> — liveness only (<code>{"ok":true}</code>)</li>
    <li><code>GET /internal/diagnostics</code> — LLM/RAG/MCP flags for operators (same secret header)</li>
    <li>POST /coach — JSON body: <code>{"text":"...","userId":"stable-id",...}</code> (optional <code>goals</code>, <code>audience</code>, <code>tonePreference</code>: formal|neutral|casual) or MCP mode <code>{"use_mcp":true,"doc_id":"…","userId":"…","text":""}</code> with <code>GOOGLE_DOCS_ACCESS_TOKEN</code> or <code>GOOGLE_DOCS_MCP_BRIDGE_URL</code> set on the server</li>
    <li>POST /dismiss — optional feedback dismiss events</li>
  </ul>
</body>
</html>`);
});

function diagnosticsPayload() {
  const attempts = resolveCoachLlmAttempts();
  return {
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
    coachLogLlm: coachLogLlmEnabled(),
    coachLogLlmFull: coachLogLlmFullBodies(),
    coachLogLlmPreview: coachLogLlmPreviewLimit(),
    googleDocsMcpBridge: Boolean((process.env.GOOGLE_DOCS_MCP_BRIDGE_URL || "").trim()),
    googleDocsAccessToken: Boolean((process.env.GOOGLE_DOCS_ACCESS_TOKEN || "").trim()),
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/internal/diagnostics", (_req, res) => {
  res.json(diagnosticsPayload());
});

app.post("/coach", coachPostRateLimiter, async (req, res) => {
  try {
    const requestId = String(req.get("x-request-id") || "").trim() || undefined;
    const result = await runCoach(req.body || {}, { requestId });
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result.payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/dismiss", dismissPostRateLimiter, async (req, res) => {
  try {
    const { userId = "anonymous", ...rest } = req.body || {};
    const profileSnapshot = await applyDismiss(userId, rest);
    res.json({ ok: true, profileSnapshot });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

const port = Number(process.env.PORT || 8787);
const listenHost = (process.env.COACHING_LISTEN_HOST || "127.0.0.1").trim() || "127.0.0.1";

await loadKnowledge().catch((e) => {
  console.error("Failed to load RAG corpus:", e);
});

app.listen(port, listenHost, () =>
  console.log(`coaching-api on http://${listenHost}:${port} (internal secret required)`),
);
