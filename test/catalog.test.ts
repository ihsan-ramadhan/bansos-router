import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { createLogger } from "../src/logger";
import { modelDef, type Upstream } from "../src/upstreams/types";

function devNull(): NodeJS.WritableStream {
  return { write: () => true } as unknown as NodeJS.WritableStream;
}

function model(id: string) {
  return modelDef({
    id,
    name: id,
    source: "zen",
    reasoning: false,
    contextWindow: 4096,
    maxTokens: 1024,
    input: ["text"],
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  });
}

test("concurrent refresh() calls share a single in-flight pass", async () => {
  let calls = 0;
  let release: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const upstream: Upstream = {
    id: "zen",
    kind: "remote-keyless",
    relayAllowed: false,
    chatUrl: "https://example.invalid/chat/completions",
    async fetchCatalog() {
      calls++;
      await gate;
      return [model("zen/m1")];
    },
    requestHeaders: () => ({}),
  };
  const catalog = new RuntimeCatalog([upstream], createLogger({ level: "error" }));

  const first = catalog.refresh();
  const second = catalog.refresh();
  const third = catalog.refresh();

  // let the async bodies reach the gate; only one fetch may have started
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);

  release!();
  const [r1, r2, r3] = await Promise.all([first, second, third]);
  assert.equal(r1.checked, 1);
  assert.equal(r1.alive, 1);
  assert.equal(r2.alive, 1);
  assert.equal(r3.alive, 1);

  // a later refresh after completion runs a fresh pass
  const after = await catalog.refresh();
  assert.equal(calls, 2);
  assert.equal(after.alive, 1);
});
test("rate-limit cooldown expires on its own and is capped", () => {
  const cat = new RuntimeCatalog([], createLogger({ out: devNull() }));
  const t0 = Date.now();

  cat.markRateLimited("a", 5_000);
  assert.equal(cat.isCoolingDown("a", t0 + 4_000), true);
  assert.equal(cat.isCoolingDown("a", t0 + 6_000), false, "expires without anyone clearing it");

  // no Retry-After: a flat minute
  cat.markRateLimited("b");
  assert.equal(cat.isCoolingDown("b", t0 + 59_000), true);
  assert.equal(cat.isCoolingDown("b", t0 + 61_000), false);

  // a wild Retry-After must not take a model out for hours
  cat.markRateLimited("c", 6 * 60 * 60_000);
  assert.equal(cat.isCoolingDown("c", t0 + 16 * 60_000), false, "capped at 15 minutes");

  assert.equal(cat.isCoolingDown("never-limited"), false);
});

test("refresh queries upstreams in parallel, not one after another", async () => {
  const slow = (id: string, ms: number): Upstream => ({
    id,
    kind: "remote-keyless",
    relayAllowed: true,
    chatUrl: `http://${id}`,
    async fetchCatalog() {
      await new Promise((r) => setTimeout(r, ms));
      return [model(`${id}-a`)];
    },
    requestHeaders() {
      return {};
    },
  });

  const cat = new RuntimeCatalog(
    [slow("zen", 120), slow("kilo", 120), slow("llm7", 120)],
    createLogger({ out: devNull() }),
  );
  const started = Date.now();
  await cat.refresh();
  const elapsed = Date.now() - started;

  // serial would be ~360ms; allow generous slack for slow CI
  assert.ok(elapsed < 300, `expected a parallel pass, took ${elapsed}ms`);
  assert.equal(cat.models.length, 3);
});
