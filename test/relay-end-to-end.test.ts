import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createLogger } from "../src/logger";
import { SEEDED_MODELS, DEFAULT_UPSTREAMS } from "../src/upstreams";
import { runRelay } from "../src/cli/relay";
import { loadRelayState, saveRelayState } from "../src/relay/egress";
import { modelDef, type ModelDef } from "../src/upstreams/types";

// Helper to spawn a mock relay server
function createMockRelayServer(shouldFail = false): Promise<{
  server: http.Server;
  relayUrl: string;
  receivedRequests: Array<{ method?: string; headers: http.IncomingHttpHeaders; body: string }>;
  close: () => Promise<void>;
}> {
  const receivedRequests: Array<{ method?: string; headers: http.IncomingHttpHeaders; body: string }> = [];

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    receivedRequests.push({
      method: req.method,
      headers: req.headers,
      body,
    });

    if (shouldFail) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "relay internal error" }));
      return;
    }

    // Emulate upstream response
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-mock-relay",
        object: "chat.completion",
        created: Date.now(),
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from mock relay" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        relayUrl: `http://127.0.0.1:${addr.port}`,
        receivedRequests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// Helper to setup bansos daemon test server
function setupTestDaemon(): Promise<{
  server: http.Server;
  baseUrl: string;
  catalog: RuntimeCatalog;
  close: () => Promise<void>;
}> {
  const log = createLogger({ level: "error" });
  const catalog = new RuntimeCatalog(DEFAULT_UPSTREAMS, log);
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
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        baseUrl,
        catalog,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test("Relay API: Full state management (add, use, toggle, remove)", async () => {
  const originalState = loadRelayState();
  const { baseUrl, close } = await setupTestDaemon();

  try {
    // 1. Initial GET
    const resGet = await fetch(`${baseUrl}/bansos/relay`);
    assert.equal(resGet.status, 200);
    const state1 = (await resGet.json()) as { enabled: boolean; url: string; relays: Array<{ url: string }> };
    assert.ok(Array.isArray(state1.relays));

    // 2. Add new relay via action: "add"
    const mockRelayUrl1 = "https://relay-sg.example.com";
    const resAdd = await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", url: mockRelayUrl1, label: "Singapore Edge" }),
    });
    assert.equal(resAdd.status, 200);
    const state2 = (await resAdd.json()) as { relays: Array<{ url: string; label?: string }> };
    const found1 = state2.relays.find((r) => r.url === mockRelayUrl1);
    assert.ok(found1);
    assert.equal(found1?.label, "Singapore Edge");

    // 3. Set active relay and enable
    const resUse = await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: mockRelayUrl1, enabled: true }),
    });
    assert.equal(resUse.status, 200);
    const state3 = (await resUse.json()) as { enabled: boolean; url: string };
    assert.equal(state3.url, mockRelayUrl1);
    assert.equal(state3.enabled, true);

    // 4. Toggle disabled
    const resToggle = await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(resToggle.status, 200);
    const state4 = (await resToggle.json()) as { enabled: boolean; url: string };
    assert.equal(state4.enabled, false);
    assert.equal(state4.url, mockRelayUrl1);

    // 5. Add second relay and remove first relay after switching
    const mockRelayUrl2 = "https://relay-us.example.com";
    await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", url: mockRelayUrl2, label: "US West" }),
    });

    // Switch active to 2
    await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: mockRelayUrl2, enabled: true }),
    });

    // Remove relay 1
    const resRemove = await fetch(`${baseUrl}/bansos/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove", url: mockRelayUrl1 }),
    });
    assert.equal(resRemove.status, 200);
    const state5 = (await resRemove.json()) as { url: string; relays: Array<{ url: string }> };
    assert.equal(state5.url, mockRelayUrl2);
    assert.ok(!state5.relays.some((r) => r.url === mockRelayUrl1));
    assert.ok(state5.relays.some((r) => r.url === mockRelayUrl2));
  } finally {
    saveRelayState(originalState);
    await close();
  }
});

test("Relay CLI: runRelay commands execute cleanly", async () => {
  const originalState = loadRelayState();

  try {
    // 1. bansos relay url <url>
    const codeAdd = await runRelay(["url", "https://cli-relay.example.com"]);
    assert.equal(codeAdd, 0);

    // 2. bansos relay use <url>
    const codeUse = await runRelay(["use", "https://cli-relay.example.com"]);
    assert.equal(codeUse, 0);
    const stateAfterUse = loadRelayState();
    assert.equal(stateAfterUse.enabled, true);
    assert.equal(stateAfterUse.url, "https://cli-relay.example.com");

    // 3. bansos relay off
    const codeOff = await runRelay(["off"]);
    assert.equal(codeOff, 0);
    assert.equal(loadRelayState().enabled, false);

    // 4. bansos relay on
    const codeOn = await runRelay(["on"]);
    assert.equal(codeOn, 0);
    assert.equal(loadRelayState().enabled, true);

    // 5. bansos relay list & status
    assert.equal(await runRelay(["list"]), 0);
    assert.equal(await runRelay(["status"]), 0);

    // 6. bansos relay remove (active cannot be removed without switching)
    const codeRemoveActive = await runRelay(["remove", "https://cli-relay.example.com"]);
    assert.equal(codeRemoveActive, 1);

    // Add and switch to another relay
    await runRelay(["use", "https://another-relay.example.com"]);
    const codeRemoveOld = await runRelay(["remove", "https://cli-relay.example.com"]);
    assert.equal(codeRemoveOld, 0);
  } finally {
    saveRelayState(originalState);
  }
});

test("Relay Egress: OpenAI Chat completions route through active relay with x-relay headers", async () => {
  const originalState = loadRelayState();
  const mockRelay = await createMockRelayServer();
  const { baseUrl, catalog, close: closeDaemon } = await setupTestDaemon();

  try {
    // Enable relay pointing to our mock relay server
    saveRelayState({
      enabled: true,
      url: mockRelay.relayUrl,
      relays: [{ url: mockRelay.relayUrl, label: "Local Test Relay" }],
    });

    // Create a mock model matching an allowed target origin (e.g. https://opencode.ai)
    const testModel: ModelDef = modelDef({
      id: "mock/relay-test:free",
      name: "Mock Relay Test",
      source: "zen",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
      compat: {
        supportsDeveloperRole: true,
        supportsReasoningEffort: false,
      },
    });
    catalog.seed([testModel]);

    // Send chat completion request
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock/relay-test:free",
        messages: [{ role: "user", content: "Hello relay" }],
      }),
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    assert.equal(json.choices[0]?.message.content, "Hello from mock relay");

    // Verify mock relay received the forwarded request with expected headers
    assert.equal(mockRelay.receivedRequests.length, 1);
    const forwarded = mockRelay.receivedRequests[0];
    assert.ok(forwarded);
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.headers["x-relay-target"], "https://opencode.ai");
    assert.equal(forwarded.headers["x-relay-path"], "/zen/v1/chat/completions");
    assert.ok(forwarded.body.includes("Hello relay"));
  } finally {
    saveRelayState(originalState);
    await mockRelay.close();
    await closeDaemon();
  }
});

test("Relay Egress: Anthropic Messages API routes through active relay and converts response", async () => {
  const originalState = loadRelayState();
  const mockRelay = await createMockRelayServer();
  const { baseUrl, catalog, close: closeDaemon } = await setupTestDaemon();

  try {
    saveRelayState({
      enabled: true,
      url: mockRelay.relayUrl,
      relays: [{ url: mockRelay.relayUrl, label: "Local Test Relay" }],
    });

    const testModel: ModelDef = modelDef({
      id: "mock/anthropic-relay:free",
      name: "Mock Anthropic Relay",
      source: "zen",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
      compat: {
        supportsDeveloperRole: true,
        supportsReasoningEffort: false,
      },
    });
    catalog.seed([testModel]);

    // Send Anthropic Messages API request
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock/anthropic-relay:free",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hello from Claude" }],
      }),
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as { type: string; role: string; content: Array<{ type: string; text: string }> };
    assert.equal(json.type, "message");
    assert.equal(json.role, "assistant");
    assert.equal(json.content[0]?.text, "Hello from mock relay");

    // Verify mock relay received request with Anthropic -> OpenAI converted body
    assert.equal(mockRelay.receivedRequests.length, 1);
    const forwarded = mockRelay.receivedRequests[0];
    assert.ok(forwarded);
    assert.equal(forwarded.headers["x-relay-target"], "https://opencode.ai");
    assert.equal(forwarded.headers["x-relay-path"], "/zen/v1/chat/completions");
    assert.ok(forwarded.body.includes("Hello from Claude"));
  } finally {
    saveRelayState(originalState);
    await mockRelay.close();
    await closeDaemon();
  }
});
