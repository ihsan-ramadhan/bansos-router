import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createLogger } from "../src/logger";
import { SEEDED_MODELS, DEFAULT_UPSTREAMS } from "../src/upstreams";
import { loadRelayState, saveRelayState } from "../src/relay/egress";

// End-to-end proof that an llm7 request leaves through the relay, not direct.
// The regression this guards was silent: ALLOWED_TARGETS held "https://llm7.io"
// while LLM7_BASE_URL is "https://api.llm7.io/v1", so relayFetch's origin check
// missed and every llm7 call bypassed the relay with no error anywhere.
// test/relay-targets.test.ts covers the allowlist invariant; this covers the
// actual forwarded request.
test("llm7 chat request is forwarded through the configured relay", async () => {
  const seen: Array<{ target?: string; path?: string; model?: string }> = [];

  const mockRelay = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    seen.push({
      target: req.headers["x-relay-target"] as string,
      path: req.headers["x-relay-path"] as string,
      model: body.model,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-mock-relay",
        object: "chat.completion",
        created: Date.now(),
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((r) => mockRelay.listen(0, "127.0.0.1", r));
  const relayUrl = `http://127.0.0.1:${(mockRelay.address() as { port: number }).port}`;

  const log = createLogger({ level: "error" });
  const catalog = new RuntimeCatalog(DEFAULT_UPSTREAMS, log);
  catalog.seed(SEEDED_MODELS);
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 1000, windowMs: 60_000 }),
    port: 0,
    log,
    startedAt: Date.now(),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const prev = loadRelayState();
  saveRelayState({ enabled: true, url: relayUrl, relays: prev.relays });

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "codestral-latest",
        messages: [{ role: "user", content: "say ok" }],
        max_tokens: 8,
      }),
    });
    assert.equal(res.status, 200);
    await res.text();

    assert.equal(seen.length, 1, "relay must receive exactly one forwarded request");
    const seen0 = seen[0]!;
    assert.equal(
      seen0.target,
      "https://api.llm7.io",
      "relay target must be the origin llm7 actually calls (LLM7_BASE_URL)",
    );
    assert.equal(seen0.path, "/v1/chat/completions");
    assert.equal(seen0.model, "codestral-latest");
  } finally {
    saveRelayState(prev);
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => mockRelay.close(() => r()));
  }
});
