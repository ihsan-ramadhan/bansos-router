import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// same lookup as the bansos cli: BANSOS_API_KEY, then <BANSOS_DIR>/api-key; never generates (the daemon does)
export function readApiKey(
  env: NodeJS.ProcessEnv = process.env,
  dir: string = env.BANSOS_DIR || path.join(os.homedir(), ".bansos"),
): string | null {
  const fromEnv = env.BANSOS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const stored = fs.readFileSync(path.join(dir, "api-key"), "utf8").trim();
    return stored || null;
  } catch {
    return null;
  }
}
