// preloaded before any test module and imports nothing from src/, so state.ts sees BANSOS_DIR already set
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.BANSOS_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-test-"));
  process.env.BANSOS_DIR = dir;
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
}

// point HOME at an empty dir so the Zen opencode-DB lookup never picks up the dev machine's real
// identity (under Bun bun:sqlite actually reads it); tests that need a specific home still set their own.
if (!process.env.BANSOS_TEST_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-test-home-"));
  process.env.BANSOS_TEST_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.LOCALAPPDATA;
  process.on("exit", () => fs.rmSync(home, { recursive: true, force: true }));
}
