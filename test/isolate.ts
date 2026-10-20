// preloaded before any test module and imports nothing from src/, so state.ts sees BANSOS_DIR already set
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.BANSOS_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-test-"));
  process.env.BANSOS_DIR = dir;
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
}
