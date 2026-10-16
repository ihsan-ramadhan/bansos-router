import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { pickFailover } from "../src/daemon/server";
import { createLogger } from "../src/logger";
import { OVH_MODELS, ovhUpstream } from "../src/upstreams/ovh";
import { modelDef } from "../src/upstreams/types";

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function listing(models: Array<{ id: string; context_length?: number }>): typeof fetch {
  return (async () => new Response(JSON.stringify({ object: "list", data: models }))) as typeof fetch;
}

test("only seeded chat models that are live make the catalog", async () => {
  const live = await withFetch(
    listing([
      { id: "gpt-oss-120b", context_length: 131_072 },
      { id: "Qwen3.6-27B", context_length: 200_000 },
      { id: "bge-m3", context_length: 8_192 },
      { id: "whisper-large-v3", context_length: 0 },
      { id: "Qwen3Guard-Gen-8B", context_length: 32_768 },
    ]),
    () => ovhUpstream.fetchCatalog(),
  );

  assert.deepEqual(live?.map((m) => m.id), ["ovh/gpt-oss-120b", "ovh/Qwen3.6-27B"]);
  assert.equal(live?.[1]?.contextWindow, 200_000, "the live context wins over the seed");
  assert.ok(live?.every((m) => m.source === "ovh"));
});

test("a zero context falls back to the seed", async () => {
  const live = await withFetch(listing([{ id: "gpt-oss-20b", context_length: 0 }]), () =>
    ovhUpstream.fetchCatalog(),
  );
  assert.equal(live?.[0]?.contextWindow, 131_072);
});

test("an unreachable or malformed listing keeps the last-known models", async () => {
  const down = await withFetch((async () => new Response("bad gateway", { status: 502 })) as typeof fetch, () =>
    ovhUpstream.fetchCatalog(),
  );
  assert.equal(down, null);

  const garbled = await withFetch((async () => new Response("{}")) as typeof fetch, () =>
    ovhUpstream.fetchCatalog(),
  );
  assert.equal(garbled, null);
});

test("the prefix stays local and no credential is sent", () => {
  const model = OVH_MODELS.find((m) => m.id === "ovh/Qwen3.5-397B-A17B")!;
  const body = ovhUpstream.transformRequestBody!({ model: model.id, stream: true }, model);
  assert.equal(body.model, "Qwen3.5-397B-A17B");
  assert.equal(body.stream, true);
  assert.deepEqual(ovhUpstream.requestHeaders(model), {});
});

test("an ovh model is a failover candidate for a same-sized model elsewhere", () => {
  const catalog = new RuntimeCatalog([], createLogger({ level: "error" }));
  const origin = modelDef({
    id: "cat-jam-free",
    name: "Cat Jam",
    source: "zen",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 131_072,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  });
  catalog.seed([origin, ...OVH_MODELS]);

  const picked = pickFailover(catalog, origin);
  assert.equal(picked?.source, "ovh");
  assert.equal(picked?.contextWindow, 262_144);
});
