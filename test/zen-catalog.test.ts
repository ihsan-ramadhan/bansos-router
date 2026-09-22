import test from "node:test";
import assert from "node:assert/strict";
import { MODELS_DEV_URL, ZEN_MODELS, zenModelFromIndex, zenUpstream } from "../src/upstreams/zen";

test("a model is built from the index with sane defaults", () => {
  const m = zenModelFromIndex("plain-free", {
    name: "Plain Free",
    reasoning: true,
    limit: { context: 262_144, output: 32_768 },
    modalities: { input: ["text"] },
  });

  assert.equal(m.name, "Plain Free");
  assert.equal(m.contextWindow, 262_144);
  assert.equal(m.maxTokens, 32_768);
  assert.equal(m.source, "zen");
  assert.equal(m.reasoning, true);
  assert.deepEqual(m.input, ["text"]);
  assert.equal(m.wireApi, undefined);
});

test("pdf survives only on the wire that can carry it", () => {
  const rich = { modalities: { input: ["text", "image", "audio", "video", "pdf"] } };

  const onResponses = zenModelFromIndex("muse-spark-1.3-contributor-free", rich);
  assert.deepEqual(onResponses.input, ["text", "image", "pdf"]);

  const onChat = zenModelFromIndex("mimo-v2.6-flash-free", rich);
  assert.deepEqual(onChat.input, ["text", "image"], "zen answers 500 for a file part here");

  const unknown = zenModelFromIndex("brand-new-free", rich);
  assert.deepEqual(unknown.input, ["text", "image"], "chat is the default wire");
});

test("a model with no deliverable modality still accepts text", () => {
  const m = zenModelFromIndex("odd-free", { modalities: { input: ["audio"] } });
  assert.deepEqual(m.input, ["text"]);
});

test("reasoning effort is never derived from the index", () => {
  const m = zenModelFromIndex("effortful-free", {
    reasoning: true,
    modalities: { input: ["text"] },
  });
  assert.equal(
    m.compat.supportsReasoningEffort,
    false,
    "a lone true would strand the model: pickFailover only pairs matching flags",
  );
});

test("the wire api is carried over from the seed, the rest comes from the index", () => {
  const m = zenModelFromIndex("muse-spark-1.3-contributor-free", {
    limit: { context: 1_048_576, output: 131_072 },
    modalities: { input: ["text", "image", "pdf"] },
  });

  assert.equal(m.wireApi, "responses", "no index carries this, only the seed does");
  assert.equal(m.contextWindow, 1_048_576, "the published figure is used as-is");
  assert.equal(m.maxTokens, 131_072);
  assert.deepEqual(m.input, ["text", "image", "pdf"]);
});

test("an index entry missing its limits keeps the seeded figures", () => {
  const seeded = ZEN_MODELS.find((m) => m.id === "muse-spark-1.3-contributor-free")!;
  const m = zenModelFromIndex(seeded.id, { modalities: { input: ["text"] } });

  assert.equal(m.name, seeded.name);
  assert.equal(m.reasoning, seeded.reasoning);
  assert.equal(m.contextWindow, seeded.contextWindow, "the 128k default would strand it in failover");
  assert.equal(m.maxTokens, seeded.maxTokens);
});

test("an index entry missing its modalities keeps the seeded ones", () => {
  const seeded = ZEN_MODELS.find((m) => m.id === "muse-spark-1.3-contributor-free")!;
  const m = zenModelFromIndex(seeded.id, {});
  assert.deepEqual(m.input, seeded.input);
});

test("a model the seed never knew gets no wire api", () => {
  const m = zenModelFromIndex("brand-new-free", { limit: { context: 1, output: 1 } });
  assert.equal(m.wireApi, undefined);
});

function stubFetch(
  index: unknown,
  listing: unknown,
  indexOk: boolean | "reject" = true,
  probeAlive: (modelId: string) => boolean = () => false,
) {
  return (async (url: string | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const id = JSON.parse(String(init.body)).model as string;
      return probeAlive(id) ? Response.json({ ok: true }) : new Response("dead", { status: 404 });
    }
    if (String(url) === MODELS_DEV_URL) {
      if (indexOk === "reject") throw new TypeError("fetch failed");
      return indexOk ? Response.json(index) : new Response("down", { status: 503 });
    }
    return Response.json(listing);
  }) as typeof fetch;
}

test("paid and deprecated models never enter the catalog", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(
    {
      opencode: {
        models: {
          "new-free": { cost: { input: 0 }, limit: { context: 1, output: 1 } },
          "paid-one": { cost: { input: 3 }, limit: { context: 1, output: 1 } },
          "gone-free": { cost: { input: 0 }, status: "deprecated" },
        },
      },
    },
    { data: [{ id: "new-free" }, { id: "paid-one" }, { id: "gone-free" }] },
  );

  try {
    const live = await zenUpstream.fetchCatalog();
    assert.deepEqual(live?.map((m) => m.id), ["new-free"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("a retired seeded model is probed, not trusted, and survives while it answers", async () => {
  const seeded = ZEN_MODELS[0]!;
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(
    { opencode: { models: { [seeded.id]: { cost: { input: 0 }, status: "deprecated" } } } },
    { data: [{ id: seeded.id }] },
    true,
    (id) => id === seeded.id,
  );

  try {
    const live = await zenUpstream.fetchCatalog();
    assert.deepEqual(live?.map((m) => m.id), [seeded.id]);
  } finally {
    globalThis.fetch = original;
  }
});

test("a retired seeded model drops out once it stops answering", async () => {
  const seeded = ZEN_MODELS[0]!;
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(
    {
      opencode: {
        models: {
          [seeded.id]: { cost: { input: 0 }, status: "deprecated" },
          "live-free": { cost: { input: 0 }, limit: { context: 1, output: 1 } },
        },
      },
    },
    { data: [{ id: seeded.id }, { id: "live-free" }] },
  );

  try {
    const live = await zenUpstream.fetchCatalog();
    assert.deepEqual(
      live?.map((m) => m.id),
      ["live-free"],
      "being listed is not enough once the index has retired it",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("an unreachable index falls back to the seed", async () => {
  const listedSeed = ZEN_MODELS.slice(0, 2);
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(null, { data: listedSeed.map((m) => ({ id: m.id })) }, false);

  try {
    const live = await zenUpstream.fetchCatalog();
    assert.deepEqual(live?.map((m) => m.id), listedSeed.map((m) => m.id));
  } finally {
    globalThis.fetch = original;
  }
});

test("an index fetch that rejects falls back to the seed too", async () => {
  const listedSeed = ZEN_MODELS.slice(0, 2);
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(null, { data: listedSeed.map((m) => ({ id: m.id })) }, "reject");

  try {
    const live = await zenUpstream.fetchCatalog();
    assert.deepEqual(
      live?.map((m) => m.id),
      listedSeed.map((m) => m.id),
      "dns failure and timeout reject, they do not answer with a status",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a seeded model the index turns paid is probed, not trusted", async () => {
  const seeded = ZEN_MODELS[0]!;
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(
    {
      opencode: {
        models: {
          [seeded.id]: { cost: { input: 3 }, limit: { context: 1, output: 1 } },
          "live-free": { cost: { input: 0 }, limit: { context: 1, output: 1 } },
        },
      },
    },
    { data: [{ id: seeded.id }, { id: "live-free" }] },
  );

  try {
    const live = await zenUpstream.fetchCatalog();
    assert.deepEqual(
      live?.map((m) => m.id),
      ["live-free"],
      "every request to a model that went paid would 401 at the gateway",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("an unreachable zen listing keeps the last-known catalog", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  try {
    assert.equal(await zenUpstream.fetchCatalog(), null);
  } finally {
    globalThis.fetch = original;
  }
});
