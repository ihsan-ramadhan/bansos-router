import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
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

// os.homedir() reads USERPROFILE on windows and HOME elsewhere, so both are pointed at the temp home
function withAnyHome<T>(home: string, fn: () => T): T {
  const real = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(real)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("a configured harness holding an old key is reported stale, the current key ok", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-doctor-key-"));
  const aider = path.join(home, ".aider.conf.yml");
  const block = (key: string) =>
    `# bansos-router:start\nopenai_api_base: http://127.0.0.1:17070/v1\nopenai_api_key: "${key}"\nmodel: x\n# bansos-router:end\n`;
  try {
    fs.writeFileSync(aider, block("bansos"));
    const stale = withAnyHome(home, () => harnessStatuses("test-key-0123456789abcdef").find((h) => h.id === "aider"));
    assert.equal(stale?.status, "configured");
    assert.equal(stale?.key, "stale");

    fs.writeFileSync(aider, block("test-key-0123456789abcdef"));
    const ok = withAnyHome(home, () => harnessStatuses("test-key-0123456789abcdef").find((h) => h.id === "aider"));
    assert.equal(ok?.key, "ok");

    const noKey = withAnyHome(home, () => harnessStatuses().find((h) => h.id === "aider"));
    assert.equal(noKey?.key, undefined, "no key passed, no key verdict");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("jcode's key is checked in its .env file, not config.toml", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-doctor-jcode-"));
  const toml = path.join(home, ".jcode", "config.toml");
  const env = path.join(home, ".config", "jcode", "openai-compatible.env");
  fs.mkdirSync(path.dirname(toml), { recursive: true });
  fs.mkdirSync(path.dirname(env), { recursive: true });
  const envBlock = (key: string) =>
    `# bansos-router:start\nJCODE_OPENAI_COMPAT_API_BASE=http://127.0.0.1:17070\nOPENAI_COMPAT_API_KEY=${key}\n# bansos-router:end\n`;
  try {
    fs.writeFileSync(
      toml,
      `# bansos-router:start\n[providers.openai-compatible]\nbase_url = "http://127.0.0.1:17070/v1"\nauth = "bearer"\n# bansos-router:end\n`,
    );
    fs.writeFileSync(env, envBlock("test-key-0123456789abcdef"));
    const ok = withAnyHome(home, () => harnessStatuses("test-key-0123456789abcdef").find((h) => h.id === "jcode"));
    assert.equal(ok?.status, "configured");
    assert.equal(ok?.key, "ok");

    fs.writeFileSync(env, envBlock("bansos"));
    const stale = withAnyHome(home, () => harnessStatuses("test-key-0123456789abcdef").find((h) => h.id === "jcode"));
    assert.equal(stale?.key, "stale");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("9router status is read from the sqlite registry when one is present", () => {
  const home = tempHome();
  const dbPath = path.join(home, ".9router", "db", "data.sqlite");
  const db = new Database(dbPath);
  db.run("CREATE TABLE providerNodes (id TEXT PRIMARY KEY, name TEXT)");
  db.query("INSERT INTO providerNodes(id, name) VALUES(?, ?)").run(
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
