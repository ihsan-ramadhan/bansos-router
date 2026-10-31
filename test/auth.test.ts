import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createSessionToken } from "../src/daemon/auth";
import { createLogger } from "../src/logger";
import { modelDef, type Upstream } from "../src/upstreams/types";

const KEY = "test-key-0123456789abcdef";
const MODEL = "mock/zen:free";

// framing headers would break the re-sent request; everything else is passed through on purpose
const FRAMING = new Set(["host", "content-length", "connection", "transfer-encoding", "keep-alive"]);

interface MockUpstream {
  url: string;
  received: http.IncomingHttpHeaders[];
  close: () => Promise<void>;
}

async function createMockUpstream(): Promise<MockUpstream> {
  const received: http.IncomingHttpHeaders[] = [];
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) {
      // drain
    }
    received.push(req.headers);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-auth",
        object: "chat.completion",
        created: 0,
        model: MODEL,
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

interface DaemonOpts {
  apiKey?: string | null;
  authFailLimit?: number;
  trustProxy?: boolean;
  upstreamUrl?: string;
  logFile?: string;
}

async function createAuthDaemon(opts: DaemonOpts = {}): Promise<{ base: string; close: () => Promise<void> }> {
  const out = opts.logFile
    ? new Writable({
        write(chunk, _enc, cb) {
          fs.appendFileSync(opts.logFile!, chunk);
          cb();
        },
      })
    : undefined;
  const log = createLogger({ level: opts.logFile ? "debug" : "error", out });
  const upstream: Upstream = {
    id: "zen",
    kind: "remote-keyless",
    relayAllowed: false,
    chatUrl: `${opts.upstreamUrl ?? "http://127.0.0.1:1"}/chat/completions`,
    fetchCatalog: async () => null,
    // worst-case passthrough: an upstream that forwards every caller header it is given
    requestHeaders: (_m, caller) => {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(caller ?? {})) {
        if (v !== undefined && !FRAMING.has(k)) flat[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      return flat;
    },
  };
  const catalog = new RuntimeCatalog([upstream], log);
  catalog.seed([
    modelDef({
      id: MODEL,
      name: "Mock Zen",
      source: "zen",
      reasoning: false,
      contextWindow: 4096,
      maxTokens: 1024,
      input: ["text"],
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    }),
  ]);
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 10_000, windowMs: 60_000 }),
    port: 0,
    log,
    startedAt: Date.now(),
    apiKey: opts.apiKey === undefined ? KEY : opts.apiKey,
    authFailLimit: opts.authFailLimit ?? 5,
    trustProxy: opts.trustProxy,
    admin: opts.logFile ? { logFile: opts.logFile } : undefined,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const chatBody = JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hello" }] });
const messagesBody = JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "hello" }] });

async function call(
  base: string,
  pathname: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const res = await fetch(`${base}${pathname}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.body,
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const PROTECTED: Array<[string, string, string?]> = [
  ["POST", "/v1/chat/completions", chatBody],
  ["POST", "/v1/messages", messagesBody],
  ["POST", "/v1/responses", JSON.stringify({ model: MODEL, input: "hi" })],
  ["GET", "/v1/models"],
  ["GET", "/models"],
  ["GET", "/bansos/status"],
  ["GET", "/bansos/config"],
  ["GET", "/bansos/events"],
  ["GET", "/bansos/usage"],
  ["GET", "/bansos/logs"],
  ["GET", "/bansos/adapters"],
  ["POST", "/bansos/refresh", "{}"],
  ["GET", "/nope"],
];

test("every route except the open surface answers 401 without a key", async () => {
  const { base, close } = await createAuthDaemon();
  try {
    for (const [method, pathname, body] of PROTECTED) {
      const res = await call(base, pathname, { method, body });
      assert.equal(res.status, 401, `${method} ${pathname}`);
      assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="bansos"', pathname);
      const json = JSON.parse(res.text);
      if (pathname === "/v1/messages") {
        assert.deepEqual(json, {
          type: "error",
          error: { type: "authentication_error", message: "invalid or missing API key" },
        });
      } else {
        assert.deepEqual(json, {
          error: { message: "invalid or missing API key", type: "authentication_error", code: "invalid_api_key" },
        });
      }
    }
  } finally {
    await close();
  }
});

test("a wrong key gets a body byte-identical to a missing key", async () => {
  const { base, close } = await createAuthDaemon();
  try {
    for (const [method, pathname, body] of [["GET", "/v1/models"], ["POST", "/v1/messages", messagesBody]] as const) {
      const missing = await call(base, pathname, { method, body });
      const wrong = await call(base, pathname, { method, body, headers: bearer("wrong-key-0123456789abcdef") });
      const wrongHeader = await call(base, pathname, { method, body, headers: { "x-api-key": "wrong-key-0123456789abcdef" } });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.text, missing.text);
      assert.equal(wrongHeader.text, missing.text);
    }
  } finally {
    await close();
  }
});

test("the right key works as Bearer in any case and as x-api-key", async () => {
  const upstream = await createMockUpstream();
  const { base, close } = await createAuthDaemon({ upstreamUrl: upstream.url });
  try {
    assert.equal((await call(base, "/v1/models", { headers: bearer(KEY) })).status, 200);
    assert.equal((await call(base, "/bansos/status", { headers: bearer(KEY) })).status, 200);
    assert.equal((await call(base, "/v1/models", { headers: { authorization: `bearer ${KEY}` } })).status, 200);
    assert.equal((await call(base, "/v1/models", { headers: { authorization: `BEARER  ${KEY} ` } })).status, 200);
    assert.equal((await call(base, "/v1/models", { headers: { "x-api-key": KEY } })).status, 200);
    assert.equal((await call(base, "/v1/models", { headers: { authorization: `Basic ${KEY}` } })).status, 401);
    const messages = await call(base, "/v1/messages", { body: messagesBody, headers: { "x-api-key": KEY } });
    assert.equal(messages.status, 200, messages.text);
    assert.equal(JSON.parse(messages.text).type, "message");
  } finally {
    await close();
    await upstream.close();
  }
});

// the dashboard shows the login screen only for 401s with www-authenticate, so an upstream 401 must not carry it
test("an upstream refusing the model answers 401 without www-authenticate", async () => {
  const refusing = http.createServer(async (req, res) => {
    for await (const _ of req) {
      // drain
    }
    res.writeHead(401, { "content-type": "application/json", "www-authenticate": 'Bearer realm="upstream"' });
    res.end(JSON.stringify({ error: { message: "model not allowed" } }));
  });
  await new Promise<void>((r) => refusing.listen(0, "127.0.0.1", r));
  const upstreamUrl = `http://127.0.0.1:${(refusing.address() as { port: number }).port}`;
  const { base, close } = await createAuthDaemon({ upstreamUrl });
  try {
    const res = await call(base, "/v1/chat/completions", {
      body: chatBody,
      headers: { ...bearer(KEY), "x-bansos-no-failover": "1" },
    });
    assert.equal(res.status, 401, res.text);
    assert.equal(res.headers.get("www-authenticate"), null);
    assert.notEqual(JSON.parse(res.text).error?.code, "invalid_api_key");
  } finally {
    await close();
    await new Promise<void>((r) => refusing.close(() => r()));
  }
});

test("/healthz is open and minimal; the static ui is open", async () => {
  const { base, close } = await createAuthDaemon();
  try {
    const health = await call(base, "/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.text, '{"status":"ok"}');
    assert.notEqual((await call(base, "/")).status, 401);
    assert.notEqual((await call(base, "/assets/missing-abc.js")).status, 401);
  } finally {
    await close();
  }
});

test("CORS preflight allows the authorization and x-api-key headers", async () => {
  const { base, close } = await createAuthDaemon();
  try {
    const res = await call(base, "/v1/chat/completions", {
      method: "OPTIONS",
      headers: {
        origin: base,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,x-api-key",
      },
    });
    assert.equal(res.status, 204);
    const allowed = res.headers.get("access-control-allow-headers") ?? "";
    assert.match(allowed, /\bauthorization\b/);
    assert.match(allowed, /\bx-api-key\b/);
  } finally {
    await close();
  }
});

test("the key and other caller credentials never reach the upstream", async () => {
  const upstream = await createMockUpstream();
  const { base, close } = await createAuthDaemon({ upstreamUrl: upstream.url });
  try {
    const chat = await call(base, "/v1/chat/completions", {
      body: chatBody,
      headers: { ...bearer(KEY), cookie: `other=${KEY}`, "proxy-authorization": `Basic ${KEY}`, "x-goog-api-key": KEY },
    });
    assert.equal(chat.status, 200, chat.text);
    const messages = await call(base, "/v1/messages", { body: messagesBody, headers: { "x-api-key": KEY } });
    assert.equal(messages.status, 200, messages.text);
    const responses = await call(base, "/v1/responses", {
      body: JSON.stringify({ model: MODEL, input: "hi" }),
      headers: bearer(KEY),
    });
    assert.equal(responses.status, 200, responses.text);

    assert.equal(upstream.received.length, 3);
    for (const headers of upstream.received) {
      for (const [name, value] of Object.entries(headers)) {
        assert.equal(String(value).includes(KEY), false, `${name} carries the key`);
      }
      for (const name of ["authorization", "x-api-key", "cookie", "proxy-authorization", "x-goog-api-key"]) {
        assert.equal(headers[name], undefined, `${name} forwarded`);
      }
    }
  } finally {
    await close();
    await upstream.close();
  }
});

test("distinct wrong keys block the ip (even the right key) with 429 and Retry-After", async () => {
  const { base, close } = await createAuthDaemon({ authFailLimit: 5 });
  try {
    // no-credential polling never counts
    for (let i = 0; i < 20; i++) assert.equal((await call(base, "/bansos/status")).status, 401);
    // counting also happens on /bansos/status, which the normal rate limiter exempts
    for (let i = 0; i < 5; i++) {
      assert.equal((await call(base, "/bansos/status", { headers: bearer(`guess-${i}-0123456789abcdef`) })).status, 401);
    }
    const blocked = await call(base, "/v1/models", { headers: bearer(KEY) });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    assert.deepEqual(JSON.parse(blocked.text), {
      error: { message: "too many failed authentication attempts", type: "rate_limit_error" },
    });
    const blockedMessages = await call(base, "/v1/messages", { body: messagesBody, headers: bearer(KEY) });
    assert.equal(blockedMessages.status, 429);
    assert.equal(JSON.parse(blockedMessages.text).error.type, "rate_limit_error");
    assert.equal(JSON.parse(blockedMessages.text).type, "error");
  } finally {
    await close();
  }
});

test("a stale key repeated many times does not lock out the right key", async () => {
  const { base, close } = await createAuthDaemon({ authFailLimit: 5 });
  try {
    for (let i = 0; i < 30; i++) {
      assert.equal((await call(base, "/v1/models", { headers: bearer("bansos") })).status, 401);
    }
    assert.equal((await call(base, "/v1/models", { headers: bearer(KEY) })).status, 200);
  } finally {
    await close();
  }
});

test("with trustProxy the right-most X-Forwarded-For entry is the client; without it XFF is ignored", async () => {
  for (const trustProxy of [true, false]) {
    const { base, close } = await createAuthDaemon({ authFailLimit: 3, trustProxy });
    try {
      for (let i = 0; i < 3; i++) {
        const res = await call(base, "/v1/models", {
          headers: { ...bearer(`guess-${i}-0123456789abcdef`), "x-forwarded-for": "6.6.6.6, 9.9.9.1" },
        });
        assert.equal(res.status, 401);
      }
      const sameClient = await call(base, "/v1/models", { headers: { ...bearer(KEY), "x-forwarded-for": "1.2.3.4, 9.9.9.1" } });
      assert.equal(sameClient.status, 429, `trustProxy=${trustProxy}: same right-most entry is blocked`);
      const otherClient = await call(base, "/v1/models", { headers: { ...bearer(KEY), "x-forwarded-for": "9.9.9.1, 9.9.9.2" } });
      assert.equal(otherClient.status, trustProxy ? 200 : 429, `trustProxy=${trustProxy}: other client`);
    } finally {
      await close();
    }
  }
});

function cookiePair(setCookie: string | null): string {
  assert.ok(setCookie);
  return setCookie.split(";")[0]!;
}

test("dashboard login sets an HttpOnly session cookie that works same-origin only", async () => {
  const { base, close } = await createAuthDaemon({ authFailLimit: 50 });
  try {
    const wrong = await call(base, "/bansos/login", { body: JSON.stringify({ key: "wrong-key-0123456789abcdef" }) });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);
    assert.equal((await call(base, "/bansos/login", { body: "not json" })).status, 400);

    const login = await call(base, "/bansos/login", { body: JSON.stringify({ key: KEY }) });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^bansos_session_\d+=v1\./);
    for (const attr of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age="]) assert.ok(setCookie.includes(attr), attr);
    assert.equal(setCookie.includes("Secure"), false);
    assert.equal(setCookie.includes(KEY), false);

    const secure = await call(base, "/bansos/login", {
      body: JSON.stringify({ key: KEY }),
      headers: { "x-forwarded-proto": "https" },
    });
    assert.match(secure.headers.get("set-cookie") ?? "", /; Secure/);

    const cookie = cookiePair(setCookie);
    assert.equal((await call(base, "/bansos/status", { headers: { cookie } })).status, 200);
    assert.equal((await call(base, "/v1/models", { headers: { cookie } })).status, 200);
    assert.equal((await call(base, "/bansos/status", { headers: { cookie, origin: base, "sec-fetch-site": "same-origin" } })).status, 200);
    assert.equal((await call(base, "/bansos/status", { headers: { cookie, origin: "http://evil.example" } })).status, 401);
    assert.equal((await call(base, "/bansos/status", { headers: { cookie, "sec-fetch-site": "cross-site" } })).status, 401);

    const [name, token] = cookie.split("=") as [string, string];
    const tampered = await call(base, "/bansos/status", { headers: { cookie: `${name}=${token.slice(0, -2)}xx` } });
    assert.equal(tampered.status, 401);
    assert.match(tampered.headers.get("set-cookie") ?? "", new RegExp(`^${name}=;.*Max-Age=0`));

    const foreign = createSessionToken("other-key-0123456789abcdef", Date.now(), 60_000);
    assert.equal((await call(base, "/bansos/status", { headers: { cookie: `${name}=${foreign}` } })).status, 401);

    const logout = await call(base, "/bansos/logout", { method: "POST", headers: { cookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await call(base, "/bansos/status", { headers: { cookie } })).status, 401, "logged-out token is revoked");
  } finally {
    await close();
  }
});

test("login is refused with 429 while the ip is blocked", async () => {
  const { base, close } = await createAuthDaemon({ authFailLimit: 3 });
  try {
    for (let i = 0; i < 3; i++) {
      const res = await call(base, "/bansos/login", { body: JSON.stringify({ key: `guess-${i}-0123456789abcdef` }) });
      assert.equal(res.status, 401);
    }
    const blocked = await call(base, "/bansos/login", { body: JSON.stringify({ key: KEY }) });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    assert.equal(blocked.headers.get("set-cookie"), null);
  } finally {
    await close();
  }
});

test("the key never appears in status, config, events, usage or render bodies", async () => {
  const upstream = await createMockUpstream();
  const { base, close } = await createAuthDaemon({ upstreamUrl: upstream.url });
  try {
    assert.equal((await call(base, "/v1/chat/completions", { body: chatBody, headers: bearer(KEY) })).status, 200);
    for (const pathname of ["/bansos/status", "/bansos/config", "/bansos/events", "/bansos/usage", "/bansos/adapters"]) {
      const res = await call(base, pathname, { headers: bearer(KEY) });
      assert.equal(res.status, 200, pathname);
      assert.equal(res.text.includes(KEY), false, pathname);
    }
    const status = JSON.parse((await call(base, "/bansos/status", { headers: bearer(KEY) })).text);
    assert.deepEqual(status.auth, { required: true });
    const render = await call(base, "/bansos/adapters/render?id=claude-code", { headers: bearer(KEY) });
    assert.equal(render.status, 200);
    assert.equal(render.text.includes(KEY), false);
    assert.ok(render.text.includes("<BANSOS_API_KEY>"));
  } finally {
    await close();
    await upstream.close();
  }
});

test("the key never reaches the log file or /bansos/logs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-auth-log-"));
  const logFile = path.join(dir, "bansosd.log");
  fs.writeFileSync(logFile, "");
  const upstream = await createMockUpstream();
  const { base, close } = await createAuthDaemon({ upstreamUrl: upstream.url, logFile, authFailLimit: 3 });
  try {
    await call(base, "/v1/models", { headers: bearer(KEY) });
    await call(base, "/v1/models", { headers: bearer(`${KEY}-wrong`) });
    await call(base, "/v1/chat/completions", { body: chatBody, headers: bearer(KEY) });
    await call(base, "/v1/messages", { body: messagesBody, headers: { "x-api-key": KEY } });
    await call(base, "/bansos/login", { body: JSON.stringify({ key: KEY }) });
    const logs = await call(base, "/bansos/logs", { headers: bearer(KEY) });
    assert.equal(logs.status, 200);
    assert.ok(JSON.parse(logs.text).lines.length > 0, "chat requests were logged");
    assert.equal(logs.text.includes(KEY), false);

    // reaching the failure limit is logged too
    for (let i = 0; i < 3; i++) await call(base, "/v1/models", { headers: bearer(`guess-${i}-0123456789abcdef`) });
    assert.equal((await call(base, "/v1/models", { headers: bearer(KEY) })).status, 429);
    const written = fs.readFileSync(logFile, "utf8");
    assert.match(written, /auth failure limit reached/);
    assert.equal(written.includes(KEY), false);
  } finally {
    await close();
    await upstream.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("apiKey null leaves the daemon open and reports auth.required false", async () => {
  const { base, close } = await createAuthDaemon({ apiKey: null });
  try {
    const status = await call(base, "/bansos/status");
    assert.equal(status.status, 200);
    assert.deepEqual(JSON.parse(status.text).auth, { required: false });
    assert.equal((await call(base, "/v1/models", { headers: bearer("anything") })).status, 200);
    const login = await call(base, "/bansos/login", { body: JSON.stringify({ key: "x" }) });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("set-cookie"), null);
  } finally {
    await close();
  }
});
