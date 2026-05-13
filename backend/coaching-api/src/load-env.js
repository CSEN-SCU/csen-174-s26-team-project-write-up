/**
 * Load env from repo-root `.env` then `backend/coaching-api/.env` (local overrides).
 * `import "dotenv/config"` only reads `process.cwd()/.env`, which misses a monorepo root `.env`.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coachingApiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const rootEnv = path.join(repoRoot, ".env");
const localEnv = path.join(coachingApiRoot, ".env");
/** When `node` is started with cwd `backend/coaching-api`, repo root is two levels up. */
const cwdRepoEnv = path.resolve(process.cwd(), "..", "..", ".env");
const cwdEnv = path.resolve(process.cwd(), ".env");

const loaded = new Set();
function loadEnvFile(filePath) {
  const norm = path.normalize(filePath);
  if (loaded.has(norm) || !existsSync(norm)) return;
  loaded.add(norm);
  dotenv.config({ path: norm });
}

loadEnvFile(rootEnv);
loadEnvFile(cwdRepoEnv);
loadEnvFile(localEnv);
loadEnvFile(cwdEnv);

if (loaded.size === 0) {
  dotenv.config();
}
