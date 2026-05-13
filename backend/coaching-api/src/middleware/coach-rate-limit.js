import rateLimit from "express-rate-limit";

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function coachKey(req) {
  const uid =
    req.body && typeof req.body.userId === "string" ? req.body.userId.trim().slice(0, 128) : "";
  return `${req.ip}:${uid || "unknown"}`;
}

/** Secondary cap on LLM-bound POST /coach (per IP + body userId per minute). */
export const coachPostRateLimiter = rateLimit({
  windowMs: 60_000,
  max: clampInt(process.env.COACHING_COACH_RATE_PER_MINUTE, 1, 200, 25),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: coachKey,
});

/** Lighter cap on POST /dismiss (per IP + userId per minute). */
export const dismissPostRateLimiter = rateLimit({
  windowMs: 60_000,
  max: clampInt(process.env.COACHING_DISMISS_RATE_PER_MINUTE, 1, 500, 120),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: coachKey,
});
