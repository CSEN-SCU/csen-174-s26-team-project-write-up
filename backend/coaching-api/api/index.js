import "../src/load-env.js";
import crypto from "crypto";
import { loadKnowledge } from "../src/rag/index.js";
import { runCoach } from "../src/coach/run-coach.js";
import { applyDismiss } from "../src/profile/index.js";
import { COACHING_INTERNAL_HEADER } from "../src/middleware/internal-secret.js";

// loadKnowledge() runs once per cold start and populates the in-memory RAG
// corpus from the knowledge/ markdown files bundled with the function.
await loadKnowledge().catch((e) => console.error("Failed to load RAG corpus:", e));

const secret = (process.env.COACHING_INTERNAL_SECRET || "").trim();

function checkSecret(req) {
  const got = (req.headers[COACHING_INTERNAL_HEADER] || "").trim();
  if (!secret || !got) return false;
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function readBody(req) {
  // Vercel pre-parses JSON bodies into req.body before the handler runs.
  // Fall back to stream reading for raw Node.js (local dev via src/index.js never hits this).
  if (req.body !== undefined) return req.body;
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const url = (req.url || "").split("?")[0];

  if (url === "/health") {
    return res.end(JSON.stringify({ ok: true }));
  }

  if (!checkSecret(req)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }

  const body = await readBody(req);

  if (req.method === "POST" && url === "/coach") {
    try {
      const result = await runCoach(body);
      if (result.error) {
        res.statusCode = result.status || 400;
        return res.end(JSON.stringify({ error: result.error }));
      }
      return res.end(JSON.stringify(result.payload));
    } catch (e) {
      console.error(e);
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: "Server error" }));
    }
  }

  if (req.method === "POST" && url === "/dismiss") {
    try {
      const { userId = "anonymous", ...rest } = body;
      const profileSnapshot = await applyDismiss(userId, rest);
      return res.end(JSON.stringify({ ok: true, profileSnapshot }));
    } catch (e) {
      console.error(e);
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: "Server error" }));
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not_found" }));
}
