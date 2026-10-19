// Loaded via --import before any test module so BANSOS_DIR is already set when
// state.ts/activity.ts evaluate their module-level paths. Without this the
// suite appended fixture events (mock/zen:free, strict-origin, zen-origin) to
// the real ~/.bansos/activity.json — the exact file the relay watchdog gates
// failover on — and restored relay state to the real relay-state.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRelayState, type RelayState } from "../src/relay/egress";

if (!process.env.BANSOS_DIR) {
  process.env.BANSOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-test-"));
}

// loadRelayState() returns the module's cached object, so holding it directly
// gives a live reference: the test then mutates the "snapshot" and the finally
// block saves that polluted state back. Tests must pair this with
// saveRelayState(snapshot) in a finally block.
export function snapshotRelayState(): RelayState {
  return structuredClone(loadRelayState());
}
