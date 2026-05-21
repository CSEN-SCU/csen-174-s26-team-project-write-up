import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const KNOWLEDGE_DIR = path.join(root, "knowledge");

// Vercel serverless functions have a read-only filesystem except for /tmp.
// process.env.VERCEL is set automatically by Vercel at runtime.
// For local dev the profile data is written to data/ next to src/.
const dataDir = process.env.VERCEL ? os.tmpdir() : path.join(root, "data");
export const DATA_DIR = dataDir;
export const PROFILE_PATH = path.join(dataDir, "profile-store.json");
