import { resolveApiKey, rotateStoredApiKey, type ApiKeySource } from "../daemon/auth";
import { API_KEY_FILE } from "../daemon/state";

// shell line that loads the key into the environment (goose reads it from there)
export const KEY_EXPORT_HINT = process.platform === "win32"
  ? "$env:BANSOS_API_KEY = (bansos key)"
  : "export BANSOS_API_KEY=$(bansos key)";

// stdout carries only the key so `export BANSOS_API_KEY=$(bansos key)` works; everything else goes to stderr
export function runKey(argv: string[], json: boolean): number {
  let rotate = false;
  for (const a of argv) {
    if (a === "--rotate") rotate = true;
    else {
      console.error(`bansos key: unknown flag "${a}"`);
      return 1;
    }
  }

  const print = (key: string, source: ApiKeySource, file: string) => {
    console.log(json ? JSON.stringify({ key, source, file }) : key);
  };

  if (rotate) {
    if (process.env.BANSOS_API_KEY !== undefined) {
      console.error("bansos key: BANSOS_API_KEY is set, so the daemon and clients use that value, not the key file");
      console.error("  change BANSOS_API_KEY where you set it, or unset it and run: bansos key --rotate");
      return 1;
    }
    let key: string;
    try {
      key = rotateStoredApiKey(API_KEY_FILE);
    } catch (err) {
      console.error(`bansos key: cannot write ${API_KEY_FILE}: ${(err as Error).message}`);
      return 1;
    }
    print(key, "file", API_KEY_FILE);
    console.error(`rotated the API key in ${API_KEY_FILE}; the old key stops working once the daemon restarts`);
    console.error("next:");
    console.error("  1. restart the daemon: bansos stop; bansos start --bg (or Settings > Restart in the web UI)");
    console.error("  2. re-run bansos setup <harness> for each configured harness (bansos doctor lists stale ones)");
    return 0;
  }

  let resolved;
  try {
    resolved = resolveApiKey({ generate: true })!;
  } catch (err) {
    console.error(`bansos key: ${(err as Error).message}`);
    return 1;
  }
  print(resolved.key, resolved.source, resolved.file);
  if (resolved.source === "env") console.error("source: BANSOS_API_KEY env");
  else if (resolved.source === "generated") console.error(`source: ${resolved.file} (generated now)`);
  else console.error(`source: ${resolved.file}`);
  return 0;
}
