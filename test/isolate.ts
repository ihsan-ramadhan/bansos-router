// Loaded via --import before any test module so BANSOS_DIR is already set when
// state.ts/activity.ts evaluate their module-level paths. Without this the
// suite appended fixture events (mock/zen:free, strict-origin, zen-origin) to
// the real ~/.bansos/activity.json — the exact file the relay watchdog gates
// failover on — and restored relay state to the real relay-state.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.BANSOS_DIR) {
  process.env.BANSOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-test-"));
}
