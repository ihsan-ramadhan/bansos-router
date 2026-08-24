import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createLogger } from "../src/logger";
import { modelDef, type ModelDef, type Upstream } from "../src/upstreams/types";

// SSE frames an openai-compatible upstream would send. `done` controls whether
// the terminating `data: [DONE]` frame is present — several upstreams omit it.
function sseBody(done: boolean): string {
  const frames = [
    'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"}}]}\n\n',
    'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n',
  ];
  if (done) frames.push("data: [DONE]\n\n");
  return frames.join("");
}

function createFakeUpstream(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1/chat/completions`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function startDaemon(chatUrl: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const log = createLogger({ level: "error" });
  const upstream: Upstream = {
    id: "zen",
    kind: "remote-keyless",
    relayAllowed: false,
    chatUrl,
    async fetchCatalog() {
      return null;
    },
    requestHeaders() {
      return {};
    },
  };
  const model: ModelDef = modelDef({
    id: "mock/stream-model:free",
    name: "Mock Stream Model",
    source: "zen",
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 4_096,
    input: ["text"],
    compat: { supportsDeveloperRole: true, supportsReasoningEffort: false },
  });
  const catalog = new RuntimeCatalog([upstream], log);
  catalog.seed([model]);
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 1000, windowMs: 60_000 }),
    port: 0,
    log,
    startedAt: Date.now(),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function postMessages(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mock/stream-model:free",
      max_tokens: 64,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

test("anthropic stream without upstream [DONE] still terminates with message_stop", async () => {
  const upstream = await createFakeUpstream(sseBody(false));
  const daemon = await startDaemon(upstream.url);
  try {
    const res = await postMessages(daemon.baseUrl);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

    const text = await res.text();
    assert.ok(text.includes("message_start"));
    assert.ok(text.includes("text_delta"));
    assert.ok(text.includes("content_block_stop"), "text block must be closed");
    assert.ok(text.includes("message_delta"), "message_delta must be sent");
    assert.ok(text.includes("message_stop"), "message_stop must terminate the stream");
    assert.equal(text.split("event: message_stop").length - 1, 1);
  } finally {
    await daemon.close();
    await upstream.close();
  }
});

test("anthropic stream with upstream [DONE] emits message_stop exactly once", async () => {
  const upstream = await createFakeUpstream(sseBody(true));
  const daemon = await startDaemon(upstream.url);
  try {
    const res = await postMessages(daemon.baseUrl);
    assert.equal(res.status, 200);

    const text = await res.text();
    assert.ok(text.includes("message_stop"));
    assert.equal(text.split("event: message_stop").length - 1, 1);
  } finally {
    await daemon.close();
    await upstream.close();
  }
});
