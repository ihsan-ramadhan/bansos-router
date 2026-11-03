import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STATE_FILE, runningDaemonUrl, startArgs } from "../src/daemon/state";

const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));

function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ["--import", "tsx", cli, ...args], { env: process.env, timeout: 30_000 }, (err, stdout) => {
      resolve({ code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, stdout });
    });
  });
}

async function withLiveDaemon(fn: (port: number) => Promise<void>, version?: string) {
  const server = http.createServer((req, res) => {
    const known = req.url === "/healthz" || (version !== undefined && req.url === "/bansos/status");
    res.writeHead(known ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", ...(version ? { version } : {}) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const state = JSON.stringify({ pid: process.pid, port, bind: "127.0.0.1", startedAt: Date.now() });
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, state);
  try {
    await fn(port);
    assert.equal(fs.readFileSync(STATE_FILE, "utf8"), state, "state.json still points at the first daemon");
  } finally {
    fs.rmSync(STATE_FILE, { force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// a manual start next to the one an agent extension already spawned used to bump to the next port
test("start --bg leaves a running daemon alone instead of starting a second one", async () => {
  await withLiveDaemon(async (port) => {
    const out = await runCli(["start", "--bg"]);
    assert.equal(out.code, 0);
    assert.match(out.stdout, new RegExp(`already running at http://127\\.0\\.0\\.1:${port}`));
  });
});

test("a foreground start and bansosd do the same", async () => {
  await withLiveDaemon(async (port) => {
    const out = await runCli(["daemon"]);
    assert.equal(out.code, 0);
    assert.match(out.stdout, new RegExp(`already running at http://127\\.0\\.0\\.1:${port}`));
  });
});

test("an explicit other port is not mistaken for the running daemon", async () => {
  await withLiveDaemon(async (port) => {
    assert.equal(await runningDaemonUrl(), `http://127.0.0.1:${port}`);
    assert.equal(await runningDaemonUrl(port), `http://127.0.0.1:${port}`);
    assert.equal(await runningDaemonUrl(port + 1), null);
  });
});

test("a stale state.json whose daemon is gone does not block a start", async () => {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: 999999, port, bind: "127.0.0.1" }));
  try {
    assert.equal(await runningDaemonUrl(), null);
  } finally {
    fs.rmSync(STATE_FILE, { force: true });
  }
});

test("bansos restart starts a daemon again with the flags it was started with", () => {
  assert.deepEqual(startArgs(), []);
  assert.deepEqual(startArgs({ port: 18000, bind: "0.0.0.0", unsafeAllowNonLoopback: true }), [
    "--port",
    "18000",
    "--bind",
    "0.0.0.0",
    "--unsafe-allow-non-loopback",
  ]);
});

// after npm i -g the CLI is new but the daemon is not, which is exactly when the notice matters
test("start --bg next to a daemon running older code says to restart it", async () => {
  await withLiveDaemon(async (port) => {
    const out = await runCli(["start", "--bg"]);
    assert.equal(out.code, 0);
    assert.match(out.stdout, new RegExp(`still runs 0\\.0\\.1, but .* is installed \\(run: bansos restart\\)`));
    assert.match(out.stdout, new RegExp(`already running at http://127\\.0\\.0\\.1:${port}`));
  }, "0.0.1");
});
