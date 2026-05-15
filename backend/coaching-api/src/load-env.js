/**
 * Mirror app-api env layering so shared secrets match:
 * 1) repo `.env`  2) `backend/app-api/.env` (override)  3) `backend/coaching-api/.env` (override)
 *
 * Without (2), `COACHING_INTERNAL_SECRET` set only in app-api/.env breaks the coaching-api proxy check.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coachingApiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const appApiRoot = path.join(repoRoot, "backend", "app-api");

const chain = [
  { path: path.join(repoRoot, ".env"), override: false },
  { path: path.join(appApiRoot, ".env"), override: true },
  { path: path.join(coachingApiRoot, ".env"), override: true },
];

const seen = new Set();
for (const { path: envPath, override } of chain) {
  const norm = path.normalize(envPath);
  if (seen.has(norm) || !existsSync(norm)) continue;
  seen.add(norm);
  dotenv.config({ path: norm, override });
}

if (seen.size === 0) {
  dotenv.config();
}
