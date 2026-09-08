import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { createServer, pickFailover } from "../src/daemon/server";
import { RateLimiter } from "../src/daemon/rate-limit";
import { normalizeSecurityConfig } from "../src/security/policy";
import type { Logger } from "../src/logger";
import type { ModelDef, Upstream } from "../src/upstreams/types";

function logger(): Logger {
  return {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger(),
  } as unknown as Logger;
}

function md(partial: Partial<ModelDef> & { id: string; source: ModelDef["source"] }): ModelDef {
  return {
    id: partial.id,
    name: partial.id,
    source: partial.source,
    reasoning: partial.reasoning ?? false,
    contextWindow: partial.contextWindow ?? 100_000,
    maxTokens: partial.maxTokens ?? 8_192,
    input: partial.input ?? ["text"],
    compat: partial.compat ?? {
      supportsReasoningEffort: false,
      supportsDeveloperRole: false,
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

const fakeUpstream = (id: string): Upstream => ({
  id,
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `http://${id}`,
  async fetchCatalog() {
    return null;
  },
  requestHeaders() {
    return {};
  },
});

const httpUpstream = (id: string, chatUrl: string): Upstream => ({
  ...fakeUpstream(id),
  chatUrl,
});

async function mockProvider(status: number, body: unknown): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function testDaemon(
  upstreams: Upstream[],
  models: ModelDef[],
  entries: Array<Record<string, unknown>>,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const log = {
    info: (msg: string, fields?: Record<string, unknown>) => entries.push({ msg, ...fields }),
    debug: () => {},
    warn: (msg: string, fields?: Record<string, unknown>) => entries.push({ msg, ...fields }),
    error: () => {},
    child: () => log,
  } as unknown as Logger;
  const security = normalizeSecurityConfig({});
  const catalog = new RuntimeCatalog(upstreams, log, security);
  catalog.seed(models);
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 1_000, windowMs: 60_000 }),
    port: 0,
    log,
    startedAt: Date.now(),
    security,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("pickFailover prefers the smallest contextWindow match from a different upstream", () => {
  // kilo has two matches: 262k and 1M. Since origin is 200k, the closer match
  // (262k) should win over 1M.
  const upstreams = [fakeUpstream("kilo"), fakeUpstream("zen")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const compat = { supportsReasoningEffort: true, supportsDeveloperRole: false };
  const zen = md({
    id: "big-pickle",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
    compat,
  });
  const kiloClose = md({
    id: "kilo-close",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 32_768,
    compat,
  });
  const kiloFar = md({
    id: "kilo-far",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    compat,
  });
  cat.seed([zen, kiloClose, kiloFar]);

  const got = pickFailover(cat, zen);
  assert.ok(got, "should pick a fallback");
  assert.equal(got!.id, "kilo-close", "smallest qualifying contextWindow wins");
});

test("pickFailover breaks maxTokens ties (larger wins)", () => {
  const upstreams = [fakeUpstream("kilo"), fakeUpstream("zen")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const zen = md({
    id: "origin",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 8_192,
  });
  const kiloA = md({
    id: "kilo-a",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144, // same ctx distance from origin
    maxTokens: 32_768,
  });
  const kiloB = md({
    id: "kilo-b",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 65_536,
  });
  cat.seed([zen, kiloA, kiloB]);

  const got = pickFailover(cat, zen);
  assert.ok(got);
  assert.equal(got!.id, "kilo-b", "when ctxWindow matches, larger maxTokens wins");
});

test("pickFailover filters on supportsReasoningEffort", () => {
  const upstreams = [fakeUpstream("kilo")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const origin = md({
    id: "origin",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
  });
  const incompatible = md({
    id: "kilo-no-effort",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  });
  cat.seed([origin, incompatible]);
  assert.equal(pickFailover(cat, origin), undefined, "reasoning effort mismatch blocks fallback");
});

test("pickFailover skips models already tried in a multi-step retry", () => {
  const upstreams = [fakeUpstream("kilo"), fakeUpstream("llm7")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const zen = md({
    id: "zen-origin",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
  });
  const kiloA = md({
    id: "kilo-a",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
  });
  const llm7A = md({
    id: "llm7-a",
    source: "llm7",
    reasoning: true,
    contextWindow: 256_000,
  });
  cat.seed([zen, kiloA, llm7A]);

  const tried = new Set(["zen-origin", "kilo-a"]);
  const got = pickFailover(cat, zen, tried);
  assert.ok(got, "should pick the untried candidate");
  assert.equal(got!.id, "llm7-a", "skips already-attempted candidates");
});

test("pickFailover returns undefined when no equivalent model exists", () => {
  const upstreams = [fakeUpstream("kilo")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const onlyZen = md({
    id: "only-zen",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
  });
  const kilo = md({
    id: "kilo-other",
    source: "kilo",
    reasoning: false, // mismatch
  });
  cat.seed([onlyZen, kilo]);
  assert.equal(pickFailover(cat, onlyZen), undefined);
});

// the log's `from`/`fromUpstream` pair must describe the model that was asked
// for. currentUpstream advances to the fallback before the warn fires, so a
// naive read reported zen models as coming from kilo.
test("the failover warning names the origin upstream, not the fallback", async () => {
  const rejecting = await mockProvider(429, { error: { message: "rate limited" } });
  const accepting = await mockProvider(200, {
    id: "x",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
  });
  const origin = md({ id: "zen-origin", source: "zen", reasoning: true, contextWindow: 128_000 });
  const fallback = md({ id: "kilo-fallback", source: "kilo", reasoning: true, contextWindow: 128_000 });

  const entries: Array<Record<string, unknown>> = [];
  const daemon = await testDaemon(
    [httpUpstream("zen", rejecting.url), httpUpstream("kilo", accepting.url)],
    [origin, fallback],
    entries,
  );

  try {
    const res = await fetch(`${daemon.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: origin.id, messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(res.status, 200);

    const warn = entries.find((e) => e.msg === "upstream rejected - fallback used");
    assert.ok(warn, "expected a failover warning");
    assert.equal(warn.from, "zen-origin");
    assert.equal(warn.to, "kilo-fallback");
    assert.equal(warn.fromUpstream, "zen");
  } finally {
    await daemon.close();
    await rejecting.close();
    await accepting.close();
  }
});
