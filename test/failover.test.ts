import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { createServer, parseRetryAfterMs, pickFailover } from "../src/daemon/server";
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

async function mockProvider(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{
  url: string;
  hits: number;
  close(): Promise<void>;
}> {
  const state = { hits: 0 };
  const server = http.createServer((_req, res) => {
    state.hits++;
    res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    get hits() {
      return state.hits;
    },
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

test("parseRetryAfterMs reads delta-seconds, http dates, and rejects junk", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(parseRetryAfterMs("30", now), 30_000);
  assert.equal(parseRetryAfterMs("  5 ", now), 5_000);
  assert.equal(parseRetryAfterMs(new Date(now + 90_000).toUTCString(), now), 90_000);
  assert.equal(parseRetryAfterMs(null, now), undefined);
  assert.equal(parseRetryAfterMs("soon", now), undefined);
  // an elapsed date or a negative delay carries no useful cooldown
  assert.equal(parseRetryAfterMs("-5", now), undefined);
  assert.equal(parseRetryAfterMs(new Date(now - 60_000).toUTCString(), now), undefined);
});

test("a 429 parks the model so the next request does not retry it", async () => {
  // Retry-After is long enough that the second request cannot expire it
  const limited = await mockProvider(429, { error: { message: "rate limited" } }, { "retry-after": "120" });
  const spare = await mockProvider(200, {
    id: "x",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
  });
  const origin = md({ id: "zen-origin", source: "zen", reasoning: true, contextWindow: 128_000 });
  const fallback = md({ id: "kilo-fallback", source: "kilo", reasoning: true, contextWindow: 128_000 });

  const entries: Array<Record<string, unknown>> = [];
  const daemon = await testDaemon(
    [httpUpstream("zen", limited.url), httpUpstream("kilo", spare.url)],
    [origin, fallback],
    entries,
  );

  const ask = () =>
    fetch(`${daemon.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: origin.id, messages: [{ role: "user", content: "hi" }] }),
    });

  try {
    assert.equal((await ask()).status, 200);
    assert.equal(limited.hits, 1, "first request learns the model is limited");

    assert.equal((await ask()).status, 200);
    assert.equal(limited.hits, 1, "second request must skip the parked model entirely");
    assert.equal(spare.hits, 2);
  } finally {
    await daemon.close();
    await limited.close();
    await spare.close();
  }
});

test("failover never hands the request to a model that is also cooling down", () => {
  const origin = md({ id: "zen-origin", source: "zen", reasoning: true, contextWindow: 100_000 });
  const cooling = md({ id: "kilo-cooling", source: "kilo", reasoning: true, contextWindow: 100_000 });
  const cat = new RuntimeCatalog([fakeUpstream("zen"), fakeUpstream("kilo")], logger());
  cat.seed([origin, cooling]);

  assert.equal(pickFailover(cat, origin)?.id, "kilo-cooling");
  cat.markRateLimited(cooling.id);
  assert.equal(
    pickFailover(cat, origin, new Set(), (c) => !cat.isCoolingDown(c.id)),
    undefined,
  );
});

test("a 403 fails over to a healthy model and parks the refused one", async () => {
  // reported in #10: a VPS gets 403 from zen, and muse is the default model
  const refusing = await mockProvider(403, { error: { message: "This service is not available in your region." } });
  const healthy = await mockProvider(200, {
    id: "x",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
  });
  const origin = md({ id: "zen-origin", source: "zen", reasoning: true, contextWindow: 128_000 });
  const fallback = md({ id: "kilo-fallback", source: "kilo", reasoning: true, contextWindow: 128_000 });

  const entries: Array<Record<string, unknown>> = [];
  const daemon = await testDaemon(
    [httpUpstream("zen", refusing.url), httpUpstream("kilo", healthy.url)],
    [origin, fallback],
    entries,
  );

  const ask = () =>
    fetch(`${daemon.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: origin.id, messages: [{ role: "user", content: "hi" }] }),
    });

  try {
    // before the fix this returned 403 and never reached the healthy model
    assert.equal((await ask()).status, 200);
    assert.equal(refusing.hits, 1);

    assert.equal((await ask()).status, 200);
    assert.equal(refusing.hits, 1, "the refused model must be parked, not retried");
    assert.equal(healthy.hits, 2);
  } finally {
    await daemon.close();
    await refusing.close();
    await healthy.close();
  }
});

test("a refused model still surfaces its own status when failover is off", async () => {
  const refusing = await mockProvider(403, { error: { message: "This service is not available in your region." } });
  const origin = md({ id: "zen-origin", source: "zen", reasoning: true, contextWindow: 128_000 });

  const entries: Array<Record<string, unknown>> = [];
  const daemon = await testDaemon([httpUpstream("zen", refusing.url)], [origin], entries);

  try {
    const res = await fetch(`${daemon.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bansos-no-failover": "1" },
      body: JSON.stringify({ model: origin.id, messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(res.status, 403);

    // the reporter's log showed a bare status=403 with no reason attached
    const warn = entries.find((e) => e.msg === "upstream rejected");
    assert.ok(warn, "expected a rejection warning");
    assert.match(String(warn.upstreamError), /not available in your region/);
  } finally {
    await daemon.close();
    await refusing.close();
  }
});

test("muse keeps nemotron as failover at its published context size", () => {
  const muse = md({ id: "muse", source: "zen", reasoning: true, contextWindow: 1_048_576 });
  const nemotron = md({ id: "nemotron", source: "kilo", reasoning: true, contextWindow: 1_000_000 });
  const cat = new RuntimeCatalog([fakeUpstream("zen"), fakeUpstream("kilo")], logger());
  cat.seed([muse, nemotron]);

  assert.equal(
    pickFailover(cat, muse)?.id,
    "nemotron",
    "a 4.6% smaller context is close enough to stand in",
  );
});

test("a candidate that covers the origin beats a closer one that falls short", () => {
  const origin = md({ id: "origin", source: "zen", reasoning: true, contextWindow: 200_000 });
  const short = md({ id: "short", source: "kilo", reasoning: true, contextWindow: 190_000 });
  const wide = md({ id: "wide", source: "kilo", reasoning: true, contextWindow: 256_000 });
  const cat = new RuntimeCatalog([fakeUpstream("zen"), fakeUpstream("kilo")], logger());
  cat.seed([origin, short, wide]);

  assert.equal(
    pickFailover(cat, origin)?.id,
    "wide",
    "a near-full-context request would 400 on the closer but smaller candidate",
  );
});

test("a candidate far below the origin context is still refused", () => {
  const big = md({ id: "big", source: "zen", reasoning: true, contextWindow: 1_000_000 });
  const small = md({ id: "small", source: "kilo", reasoning: true, contextWindow: 200_000 });
  const cat = new RuntimeCatalog([fakeUpstream("zen"), fakeUpstream("kilo")], logger());
  cat.seed([big, small]);

  assert.equal(pickFailover(cat, big), undefined);
});
