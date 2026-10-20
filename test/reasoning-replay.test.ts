import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { createServer } from "../src/daemon/server";
import { RateLimiter } from "../src/daemon/rate-limit";
import { normalizeSecurityConfig } from "../src/security/policy";
import type { Logger } from "../src/logger";
import type { Upstream } from "../src/upstreams/types";

const log = { info() {}, debug() {}, warn() {}, error() {}, child: () => log } as unknown as Logger;

async function withDaemon(fn: (baseUrl: string, bodies: any[]) => Promise<void>) {
  const bodies: any[] = [];
  const provider = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      const message = { role: "assistant", content: "done" };
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: message, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: "stop" }] }));
      }
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const upstream: Upstream = {
    id: "zen",
    kind: "remote-keyless",
    relayAllowed: true,
    chatUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1/chat/completions`,
    fetchCatalog: async () => null,
    requestHeaders: () => ({}),
  };
  const security = normalizeSecurityConfig({});
  const catalog = new RuntimeCatalog([upstream], log, security);
  catalog.seed([{
    id: "deepseek-v4.1-flash-free",
    name: "DeepSeek",
    source: "zen",
    reasoning: true,
    contextWindow: 100_000,
    maxTokens: 8_192,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }]);
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 1_000, windowMs: 60_000 }),
    port: 0,
    log,
    startedAt: Date.now(),
    security,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`, bodies);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
    await r.text();
    return r.status;
  });

const tool = { name: "weather", description: "weather", parameters: { type: "object", properties: {} } };

// a strict DeepSeek backend answers 400 when a thinking-mode tool-call turn comes back without reasoning_content
test("each client protocol hands prior reasoning back to the upstream", async () => {
  await withDaemon(async (base, bodies) => {
    assert.equal(await post(`${base}/v1/chat/completions`, {
      model: "deepseek-v4.1-flash-free",
      tools: [{ type: "function", function: tool }],
      messages: [
        { role: "user", content: "weather?" },
        { role: "assistant", content: null, reasoning_content: "chat thought", tool_calls: [{ id: "a", type: "function", function: { name: "weather", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "a", content: "18C" },
      ],
    }), 200);

    assert.equal(await post(`${base}/v1/messages`, {
      model: "deepseek-v4.1-flash-free",
      max_tokens: 64,
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.parameters }],
      messages: [
        { role: "user", content: "weather?" },
        { role: "assistant", content: [{ type: "thinking", thinking: "anthropic thought", signature: "" }, { type: "tool_use", id: "a", name: "weather", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "18C" }] },
      ],
    }), 200);

    assert.equal(await post(`${base}/v1/responses`, {
      model: "deepseek-v4.1-flash-free",
      tools: [{ type: "function", ...tool }],
      input: [
        { role: "user", content: "weather?" },
        { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "responses thought" }] },
        { type: "function_call", call_id: "a", name: "weather", arguments: "{}" },
        { type: "function_call_output", call_id: "a", output: "18C" },
      ],
    }), 200);

    assert.equal(await post(`${base}/v1/responses`, {
      model: "deepseek-v4.1-flash-free",
      tools: [{ type: "function", ...tool }],
      input: [
        { role: "user", content: "weather?" },
        { type: "function_call", call_id: "a", name: "weather", arguments: "{}" },
        { type: "function_call_output", call_id: "a", output: "18C" },
      ],
    }), 200);

    const replayed = bodies.map((b) => b.messages.find((m: any) => m.role === "assistant")?.reasoning_content);
    assert.deepEqual(replayed, ["chat thought", "anthropic thought", "responses thought", ""]);
  });
});
