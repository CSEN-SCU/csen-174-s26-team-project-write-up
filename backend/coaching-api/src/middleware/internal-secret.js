import crypto from "crypto";

/** Lowercase header name (Express normalizes incoming headers). */
export const COACHING_INTERNAL_HEADER = "x-coaching-internal-secret";

/**
 * @returns {string} trimmed shared secret from env
 */
export function assertCoachingInternalSecretConfigured() {
  const s = (process.env.COACHING_INTERNAL_SECRET || "").trim();
  if (!s) {
    console.error(
      "FATAL: COACHING_INTERNAL_SECRET is missing or empty after loading repo .env and backend/coaching-api/.env. " +
        "Add a long random value (same on app-api and coaching-api). See root .env.example.",
    );
    process.exit(1);
  }
  return s;
}

function internalSecretsMatch(expected, received) {
  const a = Buffer.from(String(received).trim(), "utf8");
  const b = Buffer.from(String(expected).trim(), "utf8");
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {string} expectedSecret
 */
export function requireCoachingInternalSecret(expectedSecret) {
  return (req, res, next) => {
    const got = (req.get(COACHING_INTERNAL_HEADER) || "").trim();
    if (!internalSecretsMatch(expectedSecret, got)) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Missing or invalid internal coaching credential.",
        hint:
          "Send header X-Coaching-Internal-Secret with the same value as COACHING_INTERNAL_SECRET in your .env. " +
          "Apps should call app-api POST /coach on port 5050 (it adds this header); do not call coaching-api :8787 from a browser without the header.",
      });
    }
    next();
  };
}
