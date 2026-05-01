import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const KNOWLEDGE_DIR = path.join(root, "knowledge");
export const DATA_DIR = path.join(root, "data");
export const PROFILE_PATH = path.join(DATA_DIR, "profile-store.json");
