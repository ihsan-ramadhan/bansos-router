import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { createLogger } from "../src/logger";
import { modelDef, type Upstream } from "../src/upstreams/types";

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