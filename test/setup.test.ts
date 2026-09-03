import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { findAdapter } from "../src/adapters";
import { applyMergeWrite, applyTomlBlockWrite, expandHome, parseJsonc, removeKeys } from "../src/cli/write";
import { SEEDED_MODELS } from "../src/upstreams";

test("expandHome uses os.homedir cross-platform", () => {
  const home = os.homedir();
  assert.equal(expandHome("~/foo/bar"), path.join(home, "foo/bar"));
  assert.equal(expandHome("~\\foo\\bar"), path.join(home, "foo\\bar"));
  assert.equal(expandHome("~"), home);
  assert.equal(expandHome("./local/file"), "./local/file");
  assert.equal(expandHome("/absolute/file"), "/absolute/file");
});

test("parseJsonc strips comments and trailing commas", () => {
  const jsonc = `
    // Configuration file
    {
      /* multi-line
         comment */
      "name": "opencode",
      "providers": {
        "url": "http://example.com//not-a-comment", // inline comment
        "trailing": true,
      },
    }
  `;
  const parsed = parseJsonc(jsonc);
  assert.equal(parsed.name, "opencode");
  assert.deepEqual(parsed.providers, {
    url: "http://example.com//not-a-comment",
    trailing: true,
  });
});

test("applyMergeWrite merges seamlessly with existing JSONC content", () => {
  const existingJsonc = `
    {
      // Existing custom provider
      "provider": {
        "custom": { "options": { "baseURL": "http://localhost:1234" } },
      },
    }
  `;
  const patch = JSON.stringify({
    provider: {
      bansos: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://127.0.0.1:17070/v1" },
      },
    },
  });

  const merged = applyMergeWrite(existingJsonc, patch);
  const parsed = JSON.parse(merged);
  assert.ok(parsed.provider.custom);
  assert.ok(parsed.provider.bansos);
  assert.equal(parsed.provider.bansos.options.baseURL, "http://127.0.0.1:17070/v1");
});

test("opencode adapter populates all models by default or single model when specified", () => {
  const adapter = findAdapter("opencode")!;

  // default: all models
  const allWrites = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.5-free",
    models: SEEDED_MODELS,
    specificModel: false,
  });
  const allParsed = JSON.parse(allWrites[0]!.content);
  assert.ok(Object.keys(allParsed.provider.bansos.models).length >= 10);
  assert.ok(allParsed.provider.bansos.models["mimo-v2.5-free"]);
  assert.ok(allParsed.provider.bansos.models["mimo-v2.5-free"]);
  assert.ok(allParsed.provider.bansos.models["kilo-auto/free"]);

  // specific model
  const specificWrites = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.5-free",
    models: SEEDED_MODELS,
    specificModel: true,
  });
  const specificParsed = JSON.parse(specificWrites[0]!.content);
  assert.deepEqual(Object.keys(specificParsed.provider.bansos.models), ["mimo-v2.5-free"]);
});

test("goose and openclaw adapters populate all models by default or single model when specified", () => {
  const goose = findAdapter("goose")!;
  const gooseAll = goose.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "deepseek-v4-flash-free",
    models: SEEDED_MODELS,
    specificModel: false,
  });
  const gooseParsed = JSON.parse(gooseAll[0]!.content);
  assert.ok(gooseParsed.models.length >= 10);

  const openclaw = findAdapter("openclaw")!;
  const openclawAll = openclaw.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "deepseek-v4-flash-free",
    models: SEEDED_MODELS,
    specificModel: false,
  });
  const openclawParsed = JSON.parse(openclawAll[0]!.content);
  assert.ok(openclawParsed.models.providers.bansos.models.length >= 10);
});

test("findAdapter resolves 9router adapter", () => {
  const adapter = findAdapter("9router");
  assert.ok(adapter);
  assert.equal(adapter.id, "9router");
  assert.equal(adapter.wire, "chat");
  assert.deepEqual(adapter.configPaths, ["~/.9router/db.json", "~/.9router/db/data.sqlite"]);

  const writes = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "deepseek-v4-flash-free",
    models: [],
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.path, "~/.9router/db.json");
  assert.equal(writes[0]?.mode, "merge");

  const parsed = JSON.parse(writes[0]?.content ?? "{}");
  assert.equal(parsed.providerNodes[0].id, "openai-compatible-chat-bansos");
  assert.equal(parsed.providerNodes[0].baseUrl, "http://127.0.0.1:17070/v1");
  assert.equal(parsed.providerConnections[0].provider, "openai-compatible-chat-bansos");
});

test("9router merge and undo preserve other providers in db.json", () => {
  const existingDb = JSON.stringify({
    providerNodes: [
      { id: "kiro", name: "Kiro AI", baseUrl: "https://kiro.ai" },
    ],
    providerConnections: [
      { id: "kiro-1", provider: "kiro", apiKey: "secret" },
    ],
  });

  const adapter = findAdapter("9router")!;
  const writes = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "deepseek-v4-flash-free",
    models: [],
  });

  const merged = applyMergeWrite(existingDb, writes[0]!.content);
  const parsedMerged = JSON.parse(merged);

  assert.equal(parsedMerged.providerNodes.length, 2);
  assert.equal(parsedMerged.providerNodes[0].id, "kiro");
  assert.equal(parsedMerged.providerNodes[1].id, "openai-compatible-chat-bansos");

  assert.equal(parsedMerged.providerConnections.length, 2);
  assert.equal(parsedMerged.providerConnections[0].id, "kiro-1");
  assert.equal(parsedMerged.providerConnections[1].id, "bansos-default");

  // test undo
  removeKeys(parsedMerged, adapter.undoKeys!);
  assert.equal(parsedMerged.providerNodes.length, 1);
  assert.equal(parsedMerged.providerNodes[0].id, "kiro");
  assert.equal(parsedMerged.providerConnections.length, 1);
  assert.equal(parsedMerged.providerConnections[0].id, "kiro-1");
});

test("continue adapter populates models array and supports merge", () => {
  const adapter = findAdapter("continue")!;
  assert.ok(adapter);
  assert.equal(adapter.id, "continue");

  const existingConfig = JSON.stringify({
    models: [
      { title: "Existing Ollama", provider: "ollama", model: "llama3" },
    ],
  });

  const writes = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.5-free",
    models: SEEDED_MODELS,
    specificModel: false,
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.mode, "merge");

  const merged = applyMergeWrite(existingConfig, writes[0]!.content);
  const parsed = JSON.parse(merged);
  assert.ok(parsed.models.length > 1);
  assert.equal(parsed.models[0].title, "Existing Ollama");
  assert.ok(parsed.models.some((m: any) => m.provider === "openai" && m.apiBase === "http://127.0.0.1:17070/v1"));
});

test("cline and roo adapters render valid openai-compatible configs and support merge", () => {
  for (const id of ["cline", "roo"]) {
    const adapter = findAdapter(id)!;
    assert.ok(adapter, `findAdapter("${id}")`);

    const writes = adapter.render({
      baseUrl: "http://127.0.0.1:17070/v1",
      defaultModel: "mimo-v2.5-free",
      models: SEEDED_MODELS,
      specificModel: true,
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.mode, "merge");

    const parsed = JSON.parse(writes[0]!.content);
    assert.equal(parsed.apiProvider, "openai-compatible");
    assert.equal(parsed.openAiBaseUrl, "http://127.0.0.1:17070/v1");
    assert.equal(parsed.openAiApiKey, "bansos");
    assert.equal(parsed.openAiModelId, "mimo-v2.5-free");

    const merged = applyMergeWrite(JSON.stringify({ customSetting: true }), writes[0]!.content);
    const parsedMerged = JSON.parse(merged);
    assert.equal(parsedMerged.customSetting, true);
    assert.equal(parsedMerged.apiProvider, "openai-compatible");

    removeKeys(parsedMerged, adapter.undoKeys!);
    assert.equal(parsedMerged.customSetting, true);
    assert.equal(parsedMerged.apiProvider, undefined);
    assert.equal(parsedMerged.openAiBaseUrl, undefined);
  }
});

test("jcode toml-block patches existing [providers.openai-compatible] without duplicating tables", () => {
  const existing = [
    "[keybindings]",
    'scroll_up = "ctrl+shift+k"',
    "",
    "[providers.openai-compatible]",
    'type = "open-ai-compatible"',
    'base_url = "http://127.0.0.1:9999/v1"',
    'auth = "bearer"',
    "model_catalog = false",
    "allow_provider_pinning = false",
    "",
    "[agents]",
    'swarm_spawn_mode = "inline"',
  ].join("\n");

  const adapter = findAdapter("jcode")!;
  const write = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.5-free",
    models: SEEDED_MODELS,
    specificModel: true,
  })[0]!;

  const out = applyTomlBlockWrite(existing, write.content, write.markers!, write.tomlTable!);

  // no duplicate table headers
  const headers = out.split("\n").filter((l) => l.trim() === "[providers.openai-compatible]");
  assert.equal(headers.length, 1);

  // root keys landed in root scope (before any section header)
  const firstSection = out.split("\n").findIndex((l) => /^\s*\[/.test(l));
  const before = out.split("\n").slice(0, firstSection).join("\n");
  assert.match(before, /default_provider = "openai-compatible"/);
  assert.match(before, /default_model = "mimo-v2\.5-free"/);

  // patched values inside the existing section
  assert.match(out, /base_url = "http:\/\/127\.0\.0\.1:17070\/v1"/);
  assert.match(out, /model_catalog = true/);
  assert.doesNotMatch(out, /model_catalog = false/);
  assert.match(out, /context_window = 200000/);

  // untouched neighbours survive
  assert.match(out, /\[keybindings\]/);
  assert.match(out, /\[agents\]/);
  assert.match(out, /swarm_spawn_mode = "inline"/);
  assert.match(out, /allow_provider_pinning = false/);
});

test("jcode toml-block on fresh file keeps root keys at top and single table", () => {
  const adapter = findAdapter("jcode")!;
  const write = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.5-free",
    models: SEEDED_MODELS,
    specificModel: true,
  })[0]!;

  const out = applyTomlBlockWrite("", write.content, write.markers!, write.tomlTable!);
  assert.equal(out.split("\n").filter((l) => l.trim() === "[providers.openai-compatible]").length, 1);
  const idxRoot = out.indexOf('default_provider = "openai-compatible"');
  const idxTable = out.indexOf("[providers.openai-compatible]");
  assert.ok(idxRoot !== -1 && idxTable !== -1 && idxRoot < idxTable);
});

test("claude-code adapter maps smart tiers in auto mode and pinned model in specific mode", () => {
  const adapter = findAdapter("claude-code")!;
  assert.ok(adapter);

  // Auto mode with seeded models (includes reasoning and non-reasoning)
  const autoWrites = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.5-free",
    models: SEEDED_MODELS,
    specificModel: false,
  });
  const autoParsed = JSON.parse(autoWrites[0]!.content);
  assert.equal(autoParsed.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:17070");
  assert.equal(autoParsed.env.ANTHROPIC_AUTH_TOKEN, "bansos");
  // Haiku should pick non-reasoning model
  const haikuDef = SEEDED_MODELS.find((m) => m.id === autoParsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
  assert.ok(haikuDef && !haikuDef.reasoning);
  // Sonnet & Opus should pick reasoning models
  const sonnetDef = SEEDED_MODELS.find((m) => m.id === autoParsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  const opusDef = SEEDED_MODELS.find((m) => m.id === autoParsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL);
  assert.ok(sonnetDef && sonnetDef.reasoning);
  assert.ok(opusDef && opusDef.reasoning);

  // Specific model pinned mode
  const pinnedWrites = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "custom-pinned-model",
    models: SEEDED_MODELS,
    specificModel: true,
  });
  const pinnedParsed = JSON.parse(pinnedWrites[0]!.content);
  assert.equal(pinnedParsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "custom-pinned-model");
  assert.equal(pinnedParsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "custom-pinned-model");
  assert.equal(pinnedParsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "custom-pinned-model");
});
