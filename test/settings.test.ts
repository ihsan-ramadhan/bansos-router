import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { createServer } from "../src/daemon/server";
import { handleAdmin } from "../src/daemon/admin";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createLogger } from "../src/logger";
import { SEEDED_MODELS } from "../src/upstreams";
import { normalizeSecurityConfig, type SecurityConfig } from "../src/security/policy";
import type { Upstream } from "../src/upstreams/types";

function upstream(id: string): Upstream {
  return {
    id: id as Upstream["id"],
    kind: "remote-keyless",
    relayAllowed: true,
    chatUrl: "https://provider.invalid/v1/chat/completions",
    async fetchCatalog() { return null; },
    requestHeaders() { return {}; },
  };
}

interface Daemon {
  baseUrl: string;
  dir: string;
  configFile: string;
  logFile: string;
  security: SecurityConfig;
  restarts: number;
  close(): Promise<void>;
}

async function startDaemon(config: unknown, opts: { bind?: string; restart?: boolean; flags?: { port?: boolean }; port?: number; requestedPort?: number } = {}): Promise<Daemon> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-settings-"));
  const configFile = path.join(dir, "config.json");
  const logFile = path.join(dir, "bansosd.log");
  if (config !== undefined) fs.writeFileSync(configFile, typeof config === "string" ? config : JSON.stringify(config));
  const log = createLogger({ level: "error" });
  const security = normalizeSecurityConfig((config as { security?: Partial<SecurityConfig> } | undefined)?.security);
  const catalog = new RuntimeCatalog(["zen", "kilo", "llm7", "ovh"].map(upstream), log, security);
  catalog.seed(SEEDED_MODELS);
  const daemon = { restarts: 0 } as Daemon;
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 1_000, windowMs: 60_000 }),
    port: opts.port ?? 17070,
    log,
    startedAt: Date.now(),
    security,
    admin: {
      requestedPort: opts.requestedPort,
      bind: opts.bind ?? "127.0.0.1",
      refreshIntervalMs: 1_800_000,
      configFile,
      logFile,
      flags: opts.flags,
      restart: opts.restart === false ? undefined : () => { daemon.restarts++; },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  return Object.assign(daemon, {
    baseUrl: `http://127.0.0.1:${port}`,
    dir,
    configFile,
    logFile,
    security,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      fs.rmSync(dir, { recursive: true, force: true });
    }),
  });
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

const BASE_CONFIG = {
  port: 17070,
  bind: "127.0.0.1",
  refreshIntervalMs: 1_800_000,
  security: { mode: "normal", allowCrossProviderFailover: false },
  auth: { enabled: true, passwordHash: "scrypt:keep-me" },
};

test("GET /bansos/config reports saved and running settings with nothing pending", async () => {
  const d = await startDaemon(BASE_CONFIG);
  try {
    const res = await fetch(`${d.baseUrl}/bansos/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.path, d.configFile);
    assert.deepEqual(body.upstreams, ["zen", "kilo", "llm7", "ovh"]);
    assert.equal(body.saved.security.mode, "normal");
    assert.equal(body.saved.security.allowCrossProviderFailover, false);
    assert.equal(body.running.port, 17070);
    assert.deepEqual(body.restartRequired, []);
    assert.equal(body.canRestart, true);
    assert.deepEqual(body.warnings, []);
  } finally {
    await d.close();
  }
});

test("saving settings validates every field and rejects bad values without touching the file", async () => {
  const d = await startDaemon(BASE_CONFIG);
  const before = fs.readFileSync(d.configFile, "utf8");
  try {
    const bad: unknown[] = [
      { security: { mode: "paranoid" } },
      { security: { dlp: "mask" } },
      { security: { allowedUpstreams: ["zen", "openai"] } },
      { security: { allowedUpstreams: "zen, kilo" } },
      { security: { allowCrossProviderFailover: "yes" } },
      { refreshIntervalMs: 5_000 },
      { refreshIntervalMs: 1.5 },
      { port: 70_000 },
      { port: "17071" },
      { bind: "example.com" },
      [],
    ];
    for (const body of bad) {
      const res = await postJson(`${d.baseUrl}/bansos/config`, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok((await res.json()).error.message);
    }
    const garbage = await fetch(`${d.baseUrl}/bansos/config`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    assert.equal(garbage.status, 400);
    assert.equal(fs.readFileSync(d.configFile, "utf8"), before);
  } finally {
    await d.close();
  }
});

test("saving security applies it live, keeps unknown keys, and flags port changes for restart", async () => {
  const d = await startDaemon(BASE_CONFIG);
  try {
    const res = await postJson(`${d.baseUrl}/bansos/config`, {
      security: { mode: "strict", dlp: "block", allowedUpstreams: ["zen", "zen", "kilo"] },
      port: 17071,
    });
    assert.equal(res.status, 200);
    const view = await res.json();
    assert.deepEqual(view.restartRequired, ["port"]);
    assert.equal(view.running.security.mode, "strict");

    const saved = JSON.parse(fs.readFileSync(d.configFile, "utf8"));
    assert.deepEqual(saved.auth, BASE_CONFIG.auth, "fields the UI does not manage survive a save");
    assert.deepEqual(saved.security, { mode: "strict", allowCrossProviderFailover: false, dlp: "block", allowedUpstreams: ["zen", "kilo"] });
    assert.equal(saved.port, 17071);

    assert.equal(d.security.mode, "strict", "the running daemon now enforces strict mode");
    assert.equal(d.security.dlp, "block");
    const status = await (await fetch(`${d.baseUrl}/bansos/status`)).json();
    assert.equal(status.security.mode, "strict");
    assert.deepEqual(status.security.allowedUpstreams, ["zen", "kilo"]);

    const blocked = await postJson(`${d.baseUrl}/v1/chat/completions`, { model: "ovh/gpt-oss-20b", messages: [{ role: "user", content: "hi" }] });
    assert.equal(blocked.status, 403, "an upstream left out of the allowlist is refused right away");
  } finally {
    await d.close();
  }
});

test("failover preference survives strict mode so switching back to normal restores it", async () => {
  const d = await startDaemon({ security: { mode: "strict", allowCrossProviderFailover: true } });
  try {
    const view = await (await fetch(`${d.baseUrl}/bansos/config`)).json();
    assert.equal(view.saved.security.allowCrossProviderFailover, true);
    assert.equal(view.running.security.allowCrossProviderFailover, false);
    const res = await postJson(`${d.baseUrl}/bansos/config`, { security: { mode: "normal" } });
    assert.equal((await res.json()).running.security.allowCrossProviderFailover, true);
  } finally {
    await d.close();
  }
});

test("strict mode cannot be switched on while the daemon listens on a non-loopback address", async () => {
  const d = await startDaemon(BASE_CONFIG, { bind: "0.0.0.0" });
  try {
    const res = await postJson(`${d.baseUrl}/bansos/config`, { security: { mode: "strict" } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /non-loopback bind/);
    assert.equal(d.security.mode, "normal");
    const lan = await postJson(`${d.baseUrl}/bansos/config`, { bind: "0.0.0.0", security: { mode: "strict" } });
    assert.equal(lan.status, 400);
  } finally {
    await d.close();
  }
});

test("a broken config file is reported and never overwritten from the UI", async () => {
  const d = await startDaemon('{"security": {"mode": "strict",}}');
  try {
    const view = await (await fetch(`${d.baseUrl}/bansos/config`)).json();
    assert.equal(view.invalid, true);
    assert.match(view.warnings[0], /not a valid JSON object/);
    const res = await postJson(`${d.baseUrl}/bansos/config`, { security: { mode: "normal" } });
    assert.equal(res.status, 409);
    assert.equal(fs.readFileSync(d.configFile, "utf8"), '{"security": {"mode": "strict",}}');
  } finally {
    await d.close();
  }
});

test("saving with no config file creates one", async () => {
  const d = await startDaemon(undefined);
  try {
    const res = await postJson(`${d.baseUrl}/bansos/config`, { refreshIntervalMs: 0 });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).restartRequired, ["refreshIntervalMs"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(d.configFile, "utf8")), { refreshIntervalMs: 0 });
  } finally {
    await d.close();
  }
});

test("restart answers first, then runs the restart hook", async () => {
  const d = await startDaemon({ ...BASE_CONFIG, port: 17099 });
  try {
    const res = await postJson(`${d.baseUrl}/bansos/restart`, {});
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { restarting: true, port: 17099, bind: "127.0.0.1" });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(d.restarts, 1);
  } finally {
    await d.close();
  }
  const pinned = await startDaemon({ ...BASE_CONFIG, port: 17099 }, { flags: { port: true } });
  try {
    const res = await postJson(`${pinned.baseUrl}/bansos/restart`, {});
    assert.equal((await res.json()).port, 17070, "a --port flag wins over the saved port");
    const view = await (await fetch(`${pinned.baseUrl}/bansos/config`)).json();
    assert.deepEqual(view.restartRequired, []);
  } finally {
    await pinned.close();
  }
  const busy = await startDaemon(BASE_CONFIG);
  try {
    const taken = Number(new URL(busy.baseUrl).port);
    fs.writeFileSync(busy.configFile, JSON.stringify({ ...BASE_CONFIG, port: taken }));
    const res = await postJson(`${busy.baseUrl}/bansos/restart`, {});
    assert.equal(res.status, 409, "a port already in use is refused before the daemon lets go of its own");
    assert.match((await res.json()).error.message, /already in use/);
    assert.equal(busy.restarts, 0);
  } finally {
    await busy.close();
  }
  const bumped = await startDaemon({ ...BASE_CONFIG, port: 17070 }, { port: 17071, requestedPort: 17070 });
  try {
    const view = await (await fetch(`${bumped.baseUrl}/bansos/config`)).json();
    assert.deepEqual(view.restartRequired, [], "an auto-bumped port is not a pending change");
    const res = await postJson(`${bumped.baseUrl}/bansos/restart`, {});
    assert.equal(res.status, 202, "the saved port being taken is what caused the bump, not a reason to refuse");
    assert.equal((await res.json()).port, 17071);
  } finally {
    await bumped.close();
  }
  const fixed = await startDaemon(BASE_CONFIG, { restart: false });
  try {
    assert.equal((await postJson(`${fixed.baseUrl}/bansos/restart`, {})).status, 501);
  } finally {
    await fixed.close();
  }
});

test("logs returns the last lines of the daemon log", async () => {
  const d = await startDaemon(BASE_CONFIG);
  try {
    const empty = await (await fetch(`${d.baseUrl}/bansos/logs`)).json();
    assert.deepEqual(empty.lines, []);
    fs.writeFileSync(d.logFile, Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n") + "\n");
    const body = await (await fetch(`${d.baseUrl}/bansos/logs?lines=5`)).json();
    assert.deepEqual(body.lines, ["line 295", "line 296", "line 297", "line 298", "line 299"]);
    const fallback = await (await fetch(`${d.baseUrl}/bansos/logs?lines=abc`)).json();
    assert.equal(fallback.lines.length, 200);
  } finally {
    await d.close();
  }
});

test("setup apply and undo write and clean a harness config in the user's home", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-home-"));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  const d = await startDaemon(BASE_CONFIG);
  try {
    const list = await (await fetch(`${d.baseUrl}/bansos/adapters`)).json();
    assert.equal(list.find((a: { id: string }) => a.id === "opencode").status, "missing");

    const applied = await (await postJson(`${d.baseUrl}/bansos/adapters/apply`, { id: "opencode" })).json();
    assert.equal(applied.ok, true);
    assert.equal(applied.harness.status, "configured");
    assert.ok(applied.lines.some((l: { kind: string; text: string }) => l.kind === "ok" && l.text.startsWith("wrote")));
    const written = fs.readFileSync(applied.harness.path, "utf8");
    assert.match(written, /127\.0\.0\.1:17070\/v1/, "harness points at the daemon, not the browser's host");

    const undone = await (await postJson(`${d.baseUrl}/bansos/adapters/apply`, { id: "opencode", undo: true })).json();
    assert.notEqual(undone.harness.status, "configured");

    const unknown = await postJson(`${d.baseUrl}/bansos/adapters/apply`, { id: "nope" });
    assert.equal(unknown.status, 404);
    const badModel = await postJson(`${d.baseUrl}/bansos/adapters/apply`, { id: "opencode", model: "no-such-model" });
    assert.equal(badModel.status, 400);
  } finally {
    await d.close();
    process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("settings refuse cross-site writes and callers that are not on this machine", async () => {
  const d = await startDaemon(BASE_CONFIG);
  try {
    const res = await postJson(`${d.baseUrl}/bansos/config`, { security: { mode: "strict" } }, { origin: "https://evil.example" });
    assert.equal(res.status, 403);
    assert.equal(d.security.mode, "normal");
  } finally {
    await d.close();
  }
  const remote = { socket: { remoteAddress: "192.168.1.20" } } as unknown as http.IncomingMessage;
  const result = await handleAdmin(remote, "GET", "/bansos/config", "/bansos/config", async () => "", {
    security: normalizeSecurityConfig({}),
    catalog: new RuntimeCatalog([], createLogger({ level: "error" })),
    port: 17070,
    bind: "0.0.0.0",
    refreshIntervalMs: 0,
  });
  assert.equal(result.status, 403);
});

test("status and doctor report real provider counts and the security actually in force", async () => {
  const d = await startDaemon(BASE_CONFIG);
  try {
    const status = await (await fetch(`${d.baseUrl}/bansos/status`)).json();
    const expected = new Map<string, number>();
    for (const m of SEEDED_MODELS) expected.set(m.source, (expected.get(m.source) ?? 0) + 1);
    assert.deepEqual(status.providers, [...expected].map(([id, models]) => ({ id, models, allowed: true })));
    assert.equal(status.providers.reduce((n: number, p: { models: number }) => n + p.models, 0), status.modelCount);
    assert.ok(!status.providers.some((p: { id: string }) => p.id === "local"), "no local upstream, so it is not claimed");
    assert.equal(status.security.dlp, "redact");

    const before = await (await fetch(`${d.baseUrl}/bansos/doctor`)).json();
    assert.equal(before.security.mode, "normal");
    await postJson(`${d.baseUrl}/bansos/config`, { security: { mode: "strict", dlp: "block", allowedUpstreams: ["zen"] } });
    const after = await (await fetch(`${d.baseUrl}/bansos/doctor`)).json();
    assert.deepEqual(
      { mode: after.security.mode, dlp: after.security.dlp, allowed: after.security.allowedUpstreams },
      { mode: "strict", dlp: "block", allowed: ["zen"] },
    );
    const strictStatus = await (await fetch(`${d.baseUrl}/bansos/status`)).json();
    assert.deepEqual(
      strictStatus.providers.filter((p: { allowed: boolean }) => !p.allowed).map((p: { id: string }) => p.id),
      [...expected.keys()].filter((id) => id !== "zen"),
      "providers outside the allowlist are reported as blocked, not available",
    );
  } finally {
    await d.close();
  }
});

test("strict mode lists and configures only models an allowed upstream serves", async () => {
  const d = await startDaemon({ ...BASE_CONFIG, security: { mode: "strict", allowedUpstreams: ["kilo"] } });
  try {
    const kiloIds = SEEDED_MODELS.filter((m) => m.source === "kilo").map((m) => m.id);
    const listed = (await (await fetch(`${d.baseUrl}/v1/models`)).json()).data.map((m: { id: string }) => m.id);
    assert.deepEqual(listed, kiloIds);
    const all = (await (await fetch(`${d.baseUrl}/v1/models?all=1`)).json()).data;
    assert.equal(all.length, SEEDED_MODELS.length, "the dashboard still sees blocked models to badge them");
    const status = await (await fetch(`${d.baseUrl}/bansos/status`)).json();
    assert.equal(status.modelCount, kiloIds.length);
    const render = await (await fetch(`${d.baseUrl}/bansos/adapters/render?id=aider`)).json();
    const text = JSON.stringify(render.config);
    assert.ok(!text.includes("muse-spark"), "the smart default skips a blocked zen model");
    assert.ok(kiloIds.some((id) => text.includes(id)));
    const pinned = await postJson(`${d.baseUrl}/bansos/adapters/apply`, { id: "aider", model: "big-pickle" });
    assert.equal(pinned.status, 400, "pinning a blocked model is refused instead of writing a config that 403s");
    assert.match((await pinned.json()).error.message, /zen, which strict mode blocks/);
  } finally {
    await d.close();
  }
});
