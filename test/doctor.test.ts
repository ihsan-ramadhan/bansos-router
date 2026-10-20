import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harnessStatuses } from "../src/cli/doctor";

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-doctor-"));
  fs.mkdirSync(path.join(home, ".9router", "db"), { recursive: true });
  return home;
}

function withHome<T>(home: string, fn: () => T): T {
  const real = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn();
  } finally {
    if (real === undefined) delete process.env.HOME;
    else process.env.HOME = real;
  }
}

// 9router lists ~/.9router/db/data.sqlite, and scanning a 27MB blob as text wedged the daemon
test("an adapter config that is a binary blob is never scanned as text", () => {
  const home = tempHome();
  const blob = Buffer.alloc(8 * 1024 * 1024, 0x7d); // brace-heavy, like a sqlite page dump
  blob.fill(0x00, 0, 4096);
  fs.writeFileSync(path.join(home, ".9router", "db", "data.sqlite"), blob);
  try {
    const t0 = Date.now();
    const status = withHome(home, () => harnessStatuses().find((h) => h.id === "9router"));
    const elapsed = Date.now() - t0;
    assert.equal(status?.status, "unconfigured");
    assert.ok(elapsed < 5000, `scanning the blob took ${elapsed}ms`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("9router status is read from the sqlite registry when one is present", (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqliteMod = (process as any).getBuiltinModule?.("node:sqlite");
  if (!sqliteMod?.DatabaseSync) {
    t.skip("node:sqlite is not available in this runtime");
    return;
  }
  const home = tempHome();
  const dbPath = path.join(home, ".9router", "db", "data.sqlite");
  const db = new sqliteMod.DatabaseSync(dbPath);
  db.exec("CREATE TABLE providerNodes (id TEXT PRIMARY KEY, name TEXT)");
  db.prepare("INSERT INTO providerNodes(id, name) VALUES(?, ?)").run(
    "openai-compatible-chat-bansos",
    "Bansos Router",
  );
  db.close();
  try {
    const status = withHome(home, () => harnessStatuses().find((h) => h.id === "9router"));
    assert.equal(status?.status, "configured");
    assert.equal(status?.path, dbPath);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
