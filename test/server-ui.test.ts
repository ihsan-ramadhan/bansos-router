import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createLogger } from "../src/logger";
import { SEEDED_MODELS } from "../src/upstreams";
import { loadRelayState, saveRelayState } from "../src/relay/egress";

function setupTestServer(): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  const log = createLogger({ level: "error" });
  const catalog = new RuntimeCatalog([], log);
  catalog.seed(SEEDED_MODELS);
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
      const addr = server.address() as { port: number; address: string };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test("GET / serves HTML", async () => {
  const { baseUrl, close } = await setupTestServer();
  try {
    const resRoot = await fetch(`${baseUrl}/`);
    assert.equal(resRoot.status, 200);
    assert.match(resRoot.headers.get("content-type") ?? "", /text\/html/);
    const textRoot = await resRoot.text();
    assert.ok(textRoot.includes("<html") || textRoot.includes("bansos-router"));
  } finally {
    await close();
  }
});

test("GET /bansos/adapters lists available adapters", async () => {
  const { baseUrl, close } = await setupTestServer();
  try {
    const res = await fetch(`${baseUrl}/bansos/adapters`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as Array<{ id: string; name: string; wire: string }>;
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 13);
    const claude = data.find((a) => a.id === "claude-code");
    assert.ok(claude);
    assert.equal(claude.name, "Claude Code");
    assert.equal(claude.wire, "anthropic");
  } finally {
    await close();
  }
});

test("GET /bansos/adapters/render renders harness config", async () => {
  const { baseUrl, close } = await setupTestServer();
  try {
    const res = await fetch(`${baseUrl}/bansos/adapters/render?id=claude-code`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { id: string; name: string; config: Array<{ path: string; content: string }> };
    assert.equal(data.id, "claude-code");
    assert.ok(data.config.length > 0);
    assert.ok(data.config[0]!.content.includes("ANTHROPIC_BASE_URL"));

    // Render with specific model
    const resModel = await fetch(`${baseUrl}/bansos/adapters/render?id=aider&model=tencent/hy3:free`);
    assert.equal(resModel.status, 200);
    const dataModel = (await resModel.json()) as { id: string; config: Array<{ content: string }> };
    assert.ok(dataModel.config[0]!.content.includes("tencent/hy3:free"));

    // Unknown adapter -> 404
    const resUnknown = await fetch(`${baseUrl}/bansos/adapters/render?id=non-existent-adapter`);
    assert.equal(resUnknown.status, 404);

    // Missing id -> 400
    const resMissing = await fetch(`${baseUrl}/bansos/adapters/render`);
    assert.equal(resMissing.status, 400);
  } finally {
    await close();
  }
});

test("GET and POST /bansos/relay read and update relay state", async () => {
  const originalState = loadRelayState();
  const { baseUrl, close } = await setupTestServer();
  try {
    const resGet = await fetch(`${baseUrl}/bansos/relay`);
    assert.equal(resGet.status, 200);
    const initial = (await resGet.json()) as { enabled: boolean; url: string; relays: Array<{ url: string }> };
    assert.equal(typeof initial.enabled, "boolean");

    // Toggle enabled
    const resPost = await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !initial.enabled }),
    });
    assert.equal(resPost.status, 200);
    const updated = (await resPost.json()) as { enabled: boolean };
    assert.equal(updated.enabled, !initial.enabled);
  } finally {
    saveRelayState(originalState);
    await close();
  }
});

test("Path traversal attempts are rejected with 403", async () => {
  const { baseUrl, close } = await setupTestServer();
  try {
    const url = new URL(baseUrl);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: "/assets/../package.json",
          method: "GET",
        },
        (res) => {
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    await close();
  }
});

test("404 returns HTML for browser navigation and JSON for API requests", async () => {
  const { baseUrl, close } = await setupTestServer();
  try {
    // API request without HTML accept header -> JSON 404
    const resJson = await fetch(`${baseUrl}/v1/non-existent-route`);
    assert.equal(resJson.status, 404);
    assert.match(resJson.headers.get("content-type") ?? "", /application\/json/);

    // Browser request with text/html accept header -> HTML 404
    const resHtml = await fetch(`${baseUrl}/v1/non-existent-route`, {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    assert.equal(resHtml.status, 404);
    assert.match(resHtml.headers.get("content-type") ?? "", /text\/html/);
    const html = await resHtml.text();
    assert.ok(html.includes("404"));
    assert.ok(html.includes("Page Not Found"));
  } finally {
    await close();
  }
});

test("POST /bansos/relay/probe tests target reachability and latency", async () => {
  const originalState = loadRelayState();
  const { baseUrl, close } = await setupTestServer();
  try {
    // Ensure clean state without active relay for step 2
    saveRelayState({ enabled: false, url: "", relays: [] });

    // 1. Probe valid local endpoint
    const res = await fetch(`${baseUrl}/bansos/relay/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `${baseUrl}/healthz` }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok: boolean; status?: number; latencyMs: number };
    assert.equal(data.ok, true);
    assert.equal(data.status, 200);
    assert.equal(typeof data.latencyMs, "number");

    // 2. Probe missing url when no active relay -> 400
    const resEmpty = await fetch(`${baseUrl}/bansos/relay/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "" }),
    });
    assert.equal(resEmpty.status, 400);

    // 3. Probe unreachable host -> returns 200 with ok: false
    const resUnreachable = await fetch(`${baseUrl}/bansos/relay/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:59999" }),
    });
    assert.equal(resUnreachable.status, 200);
    const dataUnreachable = (await resUnreachable.json()) as { ok: boolean; error?: string };
    assert.equal(dataUnreachable.ok, false);
    assert.ok(dataUnreachable.error);
  } finally {
    saveRelayState(originalState);
    await close();
  }
});
