import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createLogger } from "../src/logger";
import { loadRelayState, saveRelayState } from "../src/relay/egress";
import { modelDef, type Upstream } from "../src/upstreams/types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function assertDaemonAlive(baseUrl: string, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.status === 200) return;
    } catch {
      // daemon may be mid-crash; retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`daemon did not survive: ${baseUrl}/healthz unreachable`);
}

function createTestDaemon(mockChatUrl: string): Promise<{
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const log = createLogger({ level: "error" });
  const upstream: Upstream = {
    id: "zen",
    kind: "remote-keyless",
    relayAllowed: false,
    chatUrl: `${mockChatUrl}/chat/completions`,
    fetchCatalog: async () => null,
    requestHeaders: () => ({}),
  };
  const catalog = new RuntimeCatalog([upstream], log);
  catalog.seed([
    modelDef({
      id: "mock/zen:free",
      name: "Mock Zen",
      source: "zen",
      reasoning: false,
      contextWindow: 4096,
      maxTokens: 1024,
      input: ["text"],
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    }),
  ]);
  const rateLimiter = new RateLimiter({ limit: 1000, windowMs: 60_000 });
  const server = createServer({
    catalog,
    rateLimiter,
    port: 0,
    log,
    startedAt: Date.now(),
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// upstream that writes one valid SSE chunk and then kills the connection
// mid-stream, emulating a real free-tier gateway reset
function createAbruptUpstream(): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");

    if (body.includes('"stream":true')) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello "}}]}\n\n',
      );
      setTimeout(() => res.socket?.destroy(), 20);
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-ok",
        object: "chat.completion",
        created: Date.now(),
        model: "mock/zen:free",
        choices: [
          { index: 0, message: { role: "assistant", content: "still alive" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function rawRequest(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number }> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, path, method: "GET", headers },
      (res) => resolve({ status: res.statusCode ?? 0 }),
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// A1: mid-stream upstream failures must not crash the daemon
// ---------------------------------------------------------------------------

test("chat stream: abrupt upstream reset does not crash the daemon", async () => {
  const upstream = await createAbruptUpstream();
  const { baseUrl, close } = await createTestDaemon(upstream.url);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock/zen:free",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    await res.text().catch(() => {});
    await assertDaemonAlive(baseUrl);

    // daemon still serves a full request afterwards
    const res2 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock/zen:free",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(res2.status, 200);
    const json = (await res2.json()) as { choices: Array<{ message: { content: string } }> };
    assert.equal(json.choices[0]?.message.content, "still alive");
  } finally {
    await close();
    await upstream.close();
  }
});

test("anthropic stream: abrupt upstream reset does not crash the daemon", async () => {
  const upstream = await createAbruptUpstream();
  const { baseUrl, close } = await createTestDaemon(upstream.url);
  try {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock/zen:free",
        max_tokens: 100,
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    await res.text().catch(() => {});
    await assertDaemonAlive(baseUrl);
  } finally {
    await close();
    await upstream.close();
  }
});

test("responses stream: abrupt upstream reset does not crash the daemon", async () => {
  const upstream = await createAbruptUpstream();
  const { baseUrl, close } = await createTestDaemon(upstream.url);
  try {
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock/zen:free", input: "hello", stream: true }),
    });
    await res.text().catch(() => {});
    await assertDaemonAlive(baseUrl);
  } finally {
    await close();
    await upstream.close();
  }
});

// ---------------------------------------------------------------------------
// A2: loopback CORS + Host-header lockdown
// ---------------------------------------------------------------------------

test("loopback clients must present a loopback (or own-interface) Host header", async () => {
  const { baseUrl, close } = await createTestDaemon("http://127.0.0.1:1");
  try {
    // non-loopback Host from a loopback peer is a DNS-rebinding attempt
    const evil = await rawRequest(baseUrl, "/healthz", { host: "evil.example.com" });
    assert.equal(evil.status, 403);

    // regular loopback Host keeps working
    const url = new URL(baseUrl);
    const ok = await rawRequest(baseUrl, "/healthz", { host: `${url.hostname}:${url.port}` });
    assert.equal(ok.status, 200);
  } finally {
    await close();
  }
});

test("CORS headers are only emitted for loopback origins", async () => {
  const { baseUrl, close } = await createTestDaemon("http://127.0.0.1:1");
  try {
    const port = new URL(baseUrl).port;

    const noOrigin = await fetch(`${baseUrl}/healthz`);
    assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);

    const evil = await fetch(`${baseUrl}/healthz`, {
      headers: { origin: "https://evil.example.com" },
    });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);

    const local = await fetch(`${baseUrl}/healthz`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(local.headers.get("access-control-allow-origin"), `http://127.0.0.1:${port}`);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// A3: relay mutation payload validation
// ---------------------------------------------------------------------------

test("relay mutation rejects malformed URLs without touching state", async () => {
  const originalState = loadRelayState();
  const { baseUrl, close } = await createTestDaemon("http://127.0.0.1:1");
  try {
    saveRelayState({ enabled: false, url: "", relays: [] });

    const badUrls = [
      "ftp://relay.example.com",
      "https://user:secret@relay.example.com",
      "javascript:alert(1)",
      "not a url",
      `https://${"a".repeat(3000)}.example.com`,
    ];
    for (const url of badUrls) {
      const res = await fetch(`${baseUrl}/bansos/relay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", url }),
      });
      assert.equal(res.status, 400, `expected 400 for ${url.slice(0, 40)}`);
    }

    const after = loadRelayState();
    assert.equal(after.relays.length, 0);

    // a relays array with an invalid entry is rejected as a whole
    const resArr = await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        relays: [
          { url: "https://relay-a.example.com", label: "A" },
          { url: "http://192.168.1.1", label: "B" },
          { url: "gopher://x", label: "C" },
        ],
      }),
    });
    assert.equal(resArr.status, 400);

    // a valid relay still stores cleanly, unknown fields are dropped
    const resOk = await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add",
        url: "https://relay.example.com",
        label: "ok",
        junk: { anything: true },
      }),
    });
    assert.equal(resOk.status, 200);
    const state = loadRelayState();
    assert.equal(state.relays.length, 1);
    assert.deepEqual(Object.keys(state.relays[0] ?? {}).sort(), ["addedAt", "label", "url"]);
    assert.equal(state.relays[0]?.url, "https://relay.example.com");
  } finally {
    saveRelayState(originalState);
    await close();
  }
});
