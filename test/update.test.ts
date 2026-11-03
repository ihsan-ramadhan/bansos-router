import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { isNewerVersion, checkUpdate, peekUpdate, staleDaemonNotice, updateNotice, VERSION } from "../src/update";

// VERSION must stay in sync with package.json (single source of truth)
test("VERSION matches package.json version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  assert.equal(VERSION, pkg.version);
});

test("isNewerVersion compares semver versions correctly", () => {
  assert.equal(isNewerVersion("0.1.4", "0.1.5"), true);
  assert.equal(isNewerVersion("0.1.4", "0.2.0"), true);
  assert.equal(isNewerVersion("0.1.4", "1.0.0"), true);
  assert.equal(isNewerVersion("v0.1.4", "v0.1.5"), true);

  assert.equal(isNewerVersion("0.1.4", "0.1.4"), false);
  assert.equal(isNewerVersion("0.1.5", "0.1.4"), false);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), false);
});

test("checkUpdate returns UpdateInfo structure without throwing", async () => {
  const res = await checkUpdate("bansos-router", VERSION);
  assert.equal(typeof res.hasUpdate, "boolean");
  assert.equal(typeof res.current, "string");
  assert.equal(typeof res.latest, "string");
  assert.equal(res.current, VERSION);
});

test("updateNotice speaks only when there is something newer", () => {
  assert.equal(updateNotice({ hasUpdate: false, current: "0.5.1", latest: "0.5.1" }), null);
  assert.equal(
    updateNotice({ hasUpdate: true, current: "0.5.1", latest: "0.5.2" }),
    "Update available: 0.5.1 -> 0.5.2 (run: npm i -g bansos-router, then bansos restart)",
  );
});

test("NO_UPDATE_NOTIFIER skips the registry entirely", async () => {
  assert.equal(process.env.NO_UPDATE_NOTIFIER, "1", "the test preload opts out");
  assert.deepEqual(await checkUpdate("bansos-router", "0.0.1"), { hasUpdate: false, current: "0.0.1", latest: "0.0.1" });
});

// offline, every 5s status poll used to start another registry call because a failure never touches the cache
test("peekUpdate backs off after a failed registry call instead of retrying on every poll", async (t) => {
  const realFetch = globalThis.fetch;
  const optOut = process.env.NO_UPDATE_NOTIFIER;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("offline");
  }) as typeof fetch;
  delete process.env.NO_UPDATE_NOTIFIER;
  t.after(() => {
    globalThis.fetch = realFetch;
    process.env.NO_UPDATE_NOTIFIER = optOut;
  });

  assert.equal(peekUpdate("bansos-router-backoff-probe"), null);
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 5; i++) assert.equal(peekUpdate("bansos-router-backoff-probe"), null);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
});

test("staleDaemonNotice spots a daemon still running the code it started with", async (t) => {
  let reported = "0.0.1";
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/bansos/status" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: reported }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  assert.equal(await staleDaemonNotice(base), `bansosd at ${base} still runs 0.0.1, but ${VERSION} is installed (run: bansos restart)`);
  reported = VERSION;
  assert.equal(await staleDaemonNotice(base), null);
  assert.equal(await staleDaemonNotice("http://127.0.0.1:1"), null, "an unreachable daemon is not reported as stale");
});
