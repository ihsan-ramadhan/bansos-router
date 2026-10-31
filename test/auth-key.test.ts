import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { ClientKeyError, daemonFetch } from "../src/cli/daemon-fetch";
import {
  AuthFailureLimiter,
  CREDENTIAL_HEADERS,
  createSessionToken,
  ensureStoredApiKey,
  generateApiKey,
  readClientApiKey,
  resolveApiKey,
  resolveDaemonAuth,
  rotateStoredApiKey,
  stripCredentialHeaders,
  verifySessionToken,
} from "../src/daemon/auth";
import { createLogger, registerLogSecret } from "../src/logger";
import { scanRequestBody } from "../src/security/secret-guard";

const KEY_FORMAT = /^bansos-[A-Za-z0-9_-]{43}$/;

function tempKeyFile(): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-auth-key-"));
  return { file: path.join(dir, "api-key"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("generated keys are bansos- plus 43 base64url characters and unique", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.match(a, KEY_FORMAT);
  assert.match(b, KEY_FORMAT);
  assert.notEqual(a, b);
});

test("with no env and no file a key is generated, persisted, then read back from the file", () => {
  const { file, cleanup } = tempKeyFile();
  try {
    const first = resolveApiKey({ env: {}, file, generate: true });
    assert.ok(first);
    assert.equal(first.source, "generated");
    assert.match(first.key, KEY_FORMAT);
    assert.equal(fs.readFileSync(file, "utf8"), `${first.key}\n`);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["api-key"], "no temp file left behind");

    const second = resolveApiKey({ env: {}, file, generate: true });
    assert.deepEqual(second, { key: first.key, source: "file", file });
    assert.equal(ensureStoredApiKey(file).created, false);
  } finally {
    cleanup();
  }
});

test("without generate, a missing file resolves to null and clients never create one", () => {
  const { file, cleanup } = tempKeyFile();
  try {
    assert.equal(resolveApiKey({ env: {}, file }), null);
    assert.equal(readClientApiKey({}, file), null);
    assert.equal(fs.existsSync(file), false);
  } finally {
    cleanup();
  }
});

test("BANSOS_API_KEY wins over the file and is never written to it", () => {
  const { file, cleanup } = tempKeyFile();
  const envKey = "env-key-0123456789abcdef";
  try {
    const fromEnv = resolveApiKey({ env: { BANSOS_API_KEY: `  ${envKey} ` }, file, generate: true });
    assert.deepEqual(fromEnv, { key: envKey, source: "env", file });
    assert.equal(fs.existsSync(file), false, "env key is not persisted");

    const stored = ensureStoredApiKey(file).key;
    assert.equal(resolveApiKey({ env: { BANSOS_API_KEY: envKey }, file })?.key, envKey);
    assert.equal(readClientApiKey({ BANSOS_API_KEY: envKey }, file), envKey);
    assert.equal(readClientApiKey({}, file), stored);
    assert.equal(fs.readFileSync(file, "utf8").trim(), stored);
  } finally {
    cleanup();
  }
});

test("an invalid BANSOS_API_KEY refuses without echoing the value", () => {
  const { file, cleanup } = tempKeyFile();
  try {
    for (const bad of ["", "   ", "short", "a".repeat(513), 'quote"in-the-middle-0123', "space in-the-middle-0123"]) {
      assert.throws(
        () => resolveApiKey({ env: { BANSOS_API_KEY: bad }, file, generate: true }),
        (err: Error) => /BANSOS_API_KEY/.test(err.message) && (bad.trim() === "" || !err.message.includes(bad.trim())),
        JSON.stringify(bad.slice(0, 30)),
      );
      assert.throws(() => readClientApiKey({ BANSOS_API_KEY: bad }, file));
    }
    assert.equal(fs.existsSync(file), false, "a bad env key never falls back to generating one");
    // base64 output (+ / =) is allowed
    assert.equal(resolveApiKey({ env: { BANSOS_API_KEY: "abc+def/ghi=jkl0123=" }, file })?.key, "abc+def/ghi=jkl0123=");
  } finally {
    cleanup();
  }
});

test("a corrupt key file refuses instead of silently regenerating", () => {
  const { file, cleanup } = tempKeyFile();
  try {
    fs.writeFileSync(file, "not a key\n");
    assert.throws(() => resolveApiKey({ env: {}, file, generate: true }), /api-key.*bansos key --rotate/s);
    assert.throws(() => readClientApiKey({}, file), /does not hold a valid key/);
    assert.equal(fs.readFileSync(file, "utf8"), "not a key\n", "the file is left alone");
  } finally {
    cleanup();
  }
});

test("BANSOS_AUTH=off is loopback-only and unknown values refuse", () => {
  const { file, cleanup } = tempKeyFile();
  try {
    assert.deepEqual(resolveDaemonAuth("127.0.0.1", { BANSOS_AUTH: "off" }, file), { mode: "off" });
    assert.deepEqual(resolveDaemonAuth("localhost", { BANSOS_AUTH: " OFF " }, file), { mode: "off" });
    assert.throws(() => resolveDaemonAuth("0.0.0.0", { BANSOS_AUTH: "off" }, file), /loopback/);
    assert.throws(() => resolveDaemonAuth("127.0.0.1", { BANSOS_AUTH: "maybe" }, file), /BANSOS_AUTH/);
    assert.equal(fs.existsSync(file), false);

    const on = resolveDaemonAuth("0.0.0.0", { BANSOS_AUTH: "on" }, file);
    assert.equal(on.mode, "key");
    assert.ok(on.mode === "key" && KEY_FORMAT.test(on.key) && on.source === "generated");
    const again = resolveDaemonAuth("0.0.0.0", {}, file);
    assert.ok(again.mode === "key" && on.mode === "key" && again.key === on.key && again.source === "file");
  } finally {
    cleanup();
  }
});

test("rotate replaces the stored key", () => {
  const { file, cleanup } = tempKeyFile();
  try {
    const before = ensureStoredApiKey(file).key;
    const after = rotateStoredApiKey(file);
    assert.notEqual(after, before);
    assert.match(after, KEY_FORMAT);
    assert.equal(resolveApiKey({ env: {}, file })?.key, after);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    cleanup();
  }
});

test("stripCredentialHeaders drops every credential header and keeps the rest", () => {
  const headers = {
    authorization: "Bearer secret",
    "x-api-key": "secret",
    "proxy-authorization": "Basic secret",
    cookie: "bansos_session_1=secret",
    "x-goog-api-key": "secret",
    "content-type": "application/json",
    "x-session-affinity": "abc",
    "user-agent": ["a", "b"],
  };
  const out = stripCredentialHeaders(headers);
  for (const name of CREDENTIAL_HEADERS) assert.equal(name in out, false, name);
  assert.deepEqual(out, { "content-type": "application/json", "x-session-affinity": "abc", "user-agent": ["a", "b"] });
  assert.equal(headers.authorization, "Bearer secret", "input is not mutated");
});

test("session tokens round-trip and reject expiry, tampering, revocation and a foreign key", () => {
  const key = "test-key-0123456789abcdef";
  const now = Date.now();
  const token = createSessionToken(key, now, 60_000);
  assert.match(token, /^v1\.\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
  assert.equal(token.includes(key), false);
  const session = verifySessionToken(key, token, now);
  assert.ok(session);

  assert.equal(verifySessionToken(key, token, now + 61_000), null, "expired");
  const [v, exp, nonce, mac] = token.split(".") as [string, string, string, string];
  assert.equal(verifySessionToken(key, `${v}.${Number(exp) + 3600}.${nonce}.${mac}`, now), null, "extended expiry");
  const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
  assert.equal(verifySessionToken(key, `${v}.${exp}.${nonce}.${flipped}`, now), null, "tampered mac");
  assert.equal(verifySessionToken(key, "garbage", now), null);
  assert.equal(verifySessionToken(key, token, now, new Set([session.nonce])), null, "revoked");
  assert.equal(verifySessionToken("other-key-0123456789abcdef", token, now), null, "minted with another key");
});

test("AuthFailureLimiter blocks after N distinct wrong keys, ignores repeats, unblocks after the window", () => {
  const limiter = new AuthFailureLimiter({ limit: 3, windowMs: 1_000 });
  const t0 = 1_000_000;
  for (let i = 0; i < 50; i++) limiter.recordFailure("1.1.1.1", "bansos", t0 + i);
  assert.equal(limiter.retryAfterSec("1.1.1.1", t0 + 60), 0, "one repeated stale key never blocks");

  limiter.recordFailure("2.2.2.2", "guess-1", t0);
  limiter.recordFailure("2.2.2.2", "guess-2", t0 + 10);
  assert.equal(limiter.retryAfterSec("2.2.2.2", t0 + 20), 0);
  limiter.recordFailure("2.2.2.2", "guess-3", t0 + 20);
  assert.ok(limiter.retryAfterSec("2.2.2.2", t0 + 30) >= 1, "blocked at the limit");
  assert.equal(limiter.retryAfterSec("3.3.3.3", t0 + 30), 0, "other ips are unaffected");
  assert.equal(limiter.retryAfterSec("2.2.2.2", t0 + 1_001), 0, "unblocked once the oldest guess ages out");
});

test("AuthFailureLimiter prunes idle ips once it tracks too many", () => {
  const limiter = new AuthFailureLimiter({ limit: 2, windowMs: 1_000, maxIps: 5 });
  for (let i = 0; i < 5; i++) limiter.recordFailure(`10.0.0.${i}`, "x", 0);
  limiter.recordFailure("10.0.1.1", "y", 5_000);
  const tracked = (limiter as unknown as { failures: Map<string, unknown> }).failures;
  assert.deepEqual([...tracked.keys()], ["10.0.1.1"]);
});

function captureLogger(json: boolean): { log: ReturnType<typeof createLogger>; text: () => string } {
  const chunks: string[] = [];
  const out = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return { log: createLogger({ json, out }), text: () => chunks.join("") };
}

test("registerLogSecret scrubs the key from text and json log lines", () => {
  // a custom key with no recognisable secret shape, so only the registered-secret pass can catch it
  const key = "Custom.Key~0123456789+abcdef";
  registerLogSecret(key);
  for (const json of [false, true]) {
    const { log, text } = captureLogger(json);
    log.info(`client sent ${key} to us`);
    log.warn("upstream", { upstream: `x${key}y` });
    assert.equal(text().includes(key), false, `json=${json}: ${text()}`);
    assert.match(text(), /\[REDACTED:bansos_api_key\]/);
  }
});

// local server that records the authorization header of every request
async function headerRecorder(): Promise<{ url: string; seen: Array<string | undefined>; close: () => Promise<void> }> {
  const seen: Array<string | undefined> = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/bansos/status`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("daemonFetch sends the env key, else the key file, else no authorization header", async () => {
  const { file, cleanup } = tempKeyFile();
  const rec = await headerRecorder();
  try {
    const envKey = "env-key-0123456789abcdef";
    const res = await daemonFetch(rec.url, { headers: { "x-other": "1" } }, { env: { BANSOS_API_KEY: ` ${envKey} ` }, file });
    assert.equal(res.status, 200);
    assert.equal(rec.seen[0], `Bearer ${envKey}`);

    await daemonFetch(rec.url, {}, { env: {}, file });
    assert.equal(rec.seen[1], undefined, "no key anywhere: no header");
    assert.equal(fs.existsSync(file), false, "a client never generates a key");

    const stored = ensureStoredApiKey(file).key;
    await daemonFetch(rec.url, { method: "POST", headers: { authorization: "Bearer bansos" } }, { env: {}, file });
    assert.equal(rec.seen[2], `Bearer ${stored}`, "the stored key replaces a caller's placeholder");

    await daemonFetch(rec.url, {}, { env: { BANSOS_API_KEY: envKey }, file });
    assert.equal(rec.seen[3], `Bearer ${envKey}`, "env wins over the file");
  } finally {
    await rec.close();
    cleanup();
  }
});

test("daemonFetch refuses an invalid BANSOS_API_KEY or key file before any request", async () => {
  const { file, cleanup } = tempKeyFile();
  const rec = await headerRecorder();
  try {
    await assert.rejects(daemonFetch(rec.url, {}, { env: { BANSOS_API_KEY: "short" }, file }), (err: Error) => {
      assert.ok(err instanceof ClientKeyError);
      assert.match(err.message, /BANSOS_API_KEY/);
      return true;
    });
    fs.writeFileSync(file, "not a key\n");
    await assert.rejects(daemonFetch(rec.url, {}, { env: {}, file }), ClientKeyError);
    assert.equal(rec.seen.length, 0);
  } finally {
    await rec.close();
    cleanup();
  }
});

test("scanRequestBody flags a generated key as bansos_api_key", () => {
  const key = generateApiKey();
  assert.deepEqual(scanRequestBody(`here is ${key} ok`).secretTypes, ["bansos_api_key"]);
  assert.equal(scanRequestBody("bansos-default and bansos-router are not keys").blocked, false);
});
