import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { findAdapter, dshMergeProviders } from "../src/adapters";
import { dshEnsureDefaultModel } from "../src/cli/setup";
import { applyMergeWrite, applyTomlBlockWrite, applyYamlBlockWrite, expandHome, parseJsonc, removeBlock, removeKeys, removeTomlBlock } from "../src/cli/write";
import { SEEDED_MODELS } from "../src/upstreams";
import { START_MARKER, END_MARKER } from "../src/adapters/types";

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

test("parseJsonc reads a megabyte config with trailing commas in linear time", () => {
  const nodes = Array.from({ length: 6000 }, (_, i) => ({ id: `n${i}`, data: { tags: [i, i + 1], name: "x".repeat(40) } }));
  const jsonc = JSON.stringify({ nodes }, null, 2).replace(/\n(\s*)([}\]])/g, ",\n$1$2");
  assert.ok(jsonc.length > 1 << 20);
  const t0 = Date.now();
  const parsed = parseJsonc(jsonc);
  const elapsed = Date.now() - t0;
  assert.deepEqual(parsed, { nodes });
  assert.ok(elapsed < 2000, `parsing took ${elapsed}ms`);
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
    defaultModel: "mimo-v2.6-flash-free",
    models: SEEDED_MODELS,
    specificModel: false,
  });
  const allParsed = JSON.parse(allWrites[0]!.content);
  assert.ok(Object.keys(allParsed.provider.bansos.models).length >= 10);
  assert.ok(allParsed.provider.bansos.models["mimo-v2.6-flash-free"]);
  assert.ok(allParsed.provider.bansos.models["mimo-v2.6-flash-free"]);
  assert.ok(allParsed.provider.bansos.models["kilo-auto/free"]);

  // specific model
  const specificWrites = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.6-flash-free",
    models: SEEDED_MODELS,
    specificModel: true,
  });
  const specificParsed = JSON.parse(specificWrites[0]!.content);
  assert.deepEqual(Object.keys(specificParsed.provider.bansos.models), ["mimo-v2.6-flash-free"]);
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

  removeKeys(parsedMerged, adapter.undoKeys!);
  assert.equal(parsedMerged.providerNodes.length, 1);
  assert.equal(parsedMerged.providerNodes[0].id, "kiro");
  assert.equal(parsedMerged.providerConnections.length, 1);
  assert.equal(parsedMerged.providerConnections[0].id, "kiro-1");
});

test("continue writes the config.yaml v1 reads, nested under models", () => {
  const adapter = findAdapter("continue")!;
  assert.equal(adapter.id, "continue");
  assert.deepEqual(adapter.configPaths, ["~/.continue/config.yaml", ".continue/config.yaml"]);

  const write = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.6-flash-free",
    models: SEEDED_MODELS,
    specificModel: false,
  })[0]!;

  assert.equal(write.path, "~/.continue/config.yaml");
  assert.equal(write.mode, "yaml-block");
  assert.equal(write.yamlParent, "models");

  const existing = ["name: Mine", "version: 0.0.1", "schema: v1", "", "models:", "  - name: Mine", "    provider: ollama", "    model: llama3", ""].join("\n");
  const merged = applyYamlBlockWrite(existing, write.content, write.markers!, write.yamlParent!);

  assert.match(merged, /^  - name: Bansos - /m);
  assert.equal(merged.match(/^models:/gm)?.length, 1);
  assert.match(merged, /^  - name: Mine$/m);
  assert.match(merged, /apiBase: http:\/\/127\.0\.0\.1:17070\/v1/);
  assert.match(merged, /roles: \[chat, edit, apply\]/);

  // a file without models: gets the key, and a rerun replaces instead of piling up
  const created = applyYamlBlockWrite("name: Mine\nversion: 0.0.1\nschema: v1\n", write.content, write.markers!, write.yamlParent!);
  assert.match(created, /^models:$/m);
  const twice = applyYamlBlockWrite(created, write.content, write.markers!, write.yamlParent!);
  assert.equal(twice, created);
  assert.equal(twice.match(/Bansos - /g)?.length, SEEDED_MODELS.length);
});

test("continue undo drops our models whether or not continue kept the comments", () => {
  const adapter = findAdapter("continue")!;
  const write = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "a",
    models: SEEDED_MODELS.slice(0, 2),
    specificModel: false,
  })[0]!;

  const merged = applyYamlBlockWrite("models:\n  - name: Mine\n    provider: ollama\n", write.content, write.markers!, write.yamlParent!);
  const withComments = removeBlock(merged, write.markers!);
  assert.doesNotMatch(withComments, /Bansos - /);
  assert.match(withComments, /- name: Mine/);

  const rewritten = merged.replace(/^\s*# bansos-router.*\n/gm, "");
  assert.equal(adapter.detect!(merged), true);
  assert.equal(adapter.detect!(rewritten), true, "detection survives continue stripping our comments");
  assert.equal(adapter.detect!("models:\n  - name: Mine\n"), false);
  const stripped = adapter.undoContent!(rewritten);
  assert.doesNotMatch(stripped, /Bansos - /);
  assert.match(stripped, /- name: Mine/);
});

test("cline writes the providers file its extension, CLI and SDK all read", () => {
  const adapter = findAdapter("cline")!;
  const write = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.6-flash-free",
    models: SEEDED_MODELS,
    specificModel: true,
  })[0]!;

  assert.equal(write.path, "~/.cline/data/settings/providers.json");
  assert.equal(write.mode, "merge");

  const merged = JSON.parse(applyMergeWrite(JSON.stringify({ customSetting: true }), write.content, write.replace));
  const provider = merged.providers["openai-compatible"];
  assert.equal(merged.customSetting, true);
  assert.equal(merged.lastUsedProvider, "openai-compatible");
  assert.equal(provider.provider, "openai-compatible");
  assert.equal(provider.baseUrl, "http://127.0.0.1:17070/v1");
  assert.equal(provider.apiKey, "bansos");
  assert.equal(provider.model, "mimo-v2.6-flash-free");
});

test("antigravity and roo have no adapter: neither CLI can take a custom endpoint", () => {
  assert.equal(findAdapter("antigravity"), undefined);
  assert.equal(findAdapter("roo"), undefined);
});
test("jcode writes the profile plus the [provider] default jcode actually reads", () => {
  const adapter = findAdapter("jcode")!;
  const writes = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "big-pickle",
    models: SEEDED_MODELS,
    specificModel: false,
  });

  // one write per table: the merge writer can only patch a single table per block
  assert.equal(writes.length, 2);
  assert.equal(writes[0]!.tomlTable, "provider");
  assert.equal(writes[1]!.tomlTable, "providers.bansos");

  let out = "";
  for (const write of writes) {
    out = applyTomlBlockWrite(out, write.content, write.markers!, write.tomlTable!, write.fillOnly ?? false);
  }

  // root-level default_provider is ignored by jcode, so it has to sit in [provider]
  assert.equal(out.split("\n").filter((l) => l.trim() === "[provider]").length, 1);
  assert.equal(out.split("\n").filter((l) => l.trim() === "[providers.bansos]").length, 1);
  const providerIdx = out.indexOf("[provider]");
  const profileIdx = out.indexOf("[providers.bansos]");
  const defaultIdx = out.indexOf('default_provider = "bansos"');
  assert.ok(providerIdx !== -1 && providerIdx < defaultIdx && defaultIdx < profileIdx);
  assert.match(out, /type = "openai-compatible"/);
  assert.match(out, /base_url = "http:\/\/127\.0\.0\.1:17070\/v1"/);
  // no env file, no key to look up
  assert.match(out, /auth = "none"/);
  assert.match(out, /requires_api_key = false/);
  assert.match(out, /model_catalog = true/);
  // jcode only builds picker routes for a non-active profile from models/default_model
  assert.match(out, /default_model = "big-pickle"/);
  assert.match(out, /models = \[\{ id = "[^"]+" \}/);
  assert.equal(writes[0]!.fillOnly, true);
  assert.equal(adapter.undo({ baseUrl: "", defaultModel: "", models: [] }).length, 1);
});

test("jcode setup stays valid when it runs twice", () => {
  const adapter = findAdapter("jcode")!;
  const ctx = {
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "big-pickle",
    models: SEEDED_MODELS,
    specificModel: false,
  };

  let out = "";
  for (let run = 0; run < 3; run++) {
    for (const write of adapter.render(ctx)) {
      out = applyTomlBlockWrite(out, write.content, write.markers!, write.tomlTable!, write.fillOnly ?? false);
    }
  }

  // a second [providers.bansos] table makes the whole config unparseable for jcode
  assert.equal(out.split("\n").filter((l) => l.trim() === "[providers.bansos]").length, 1);
  assert.equal(out.split("\n").filter((l) => l.trim() === "[provider]").length, 1);
  assert.equal(out.split("\n").filter((l) => l.startsWith("models = ")).length, 1);
  assert.equal(out.split("\n").filter((l) => l.startsWith("default_provider = ")).length, 1);
});

test("jcode is still detected and undoable after jcode rewrites the file without our comments", () => {
  const adapter = findAdapter("jcode")!;
  // jcode drops comments on every save: the block markers are gone, the values are not
  const rewritten = [
    "[provider]",
    'default_provider = "bansos"',
    'default_model = "big-pickle"',
    "",
    "[providers.bansos]",
    'type = "openai-compatible"',
    'base_url = "http://127.0.0.1:17070/v1"',
    "",
    "[keybindings]",
    'scroll_up = "ctrl+shift+k"',
    "",
  ].join("\n");

  assert.equal(adapter.detect!(rewritten), true);
  assert.equal(adapter.detect!("[providers.deepseek]\n"), false);

  const undone = adapter.undoContent!(rewritten);
  assert.doesNotMatch(undone, /providers\.bansos/);
  assert.doesNotMatch(undone, /default_provider/);
  assert.doesNotMatch(undone, /default_model/);
  assert.match(undone, /\[keybindings\]/);
  assert.match(undone, /scroll_up = "ctrl\+shift\+k"/);
});

test("jcode keeps a provider the user already picked and still writes the profile", () => {
  const existing = [
    "[keybindings]",
    'scroll_up = "ctrl+shift+k"',
    "",
    "[provider]",
    'default_provider = "claude"',
    'default_model = "claude-opus-4-8"',
    "",
    "[agents]",
    'swarm_spawn_mode = "inline"',
  ].join("\n");

  const adapter = findAdapter("jcode")!;
  let out = existing;
  for (const write of adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "big-pickle",
    models: SEEDED_MODELS,
    specificModel: false,
  })) {
    out = applyTomlBlockWrite(out, write.content, write.markers!, write.tomlTable!, write.fillOnly ?? false);
  }

  // setup registers the router, it does not decide which provider the user starts on
  assert.match(out, /default_provider = "claude"/);
  assert.doesNotMatch(out, /default_provider = "bansos"/);
  assert.equal(out.split("\n").filter((l) => l.trim() === "[providers.bansos]").length, 1);
  assert.match(out, /\[keybindings\]/);
  assert.match(out, /\[agents\]/);
});

test("claude-code adapter maps smart tiers in auto mode and pinned model in specific mode", () => {
  const adapter = findAdapter("claude-code")!;
  assert.ok(adapter);

  // auto mode, seeded with both reasoning and non-reasoning models
  const autoWrites = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "mimo-v2.6-flash-free",
    models: SEEDED_MODELS,
    specificModel: false,
  });
  const autoParsed = JSON.parse(autoWrites[0]!.content);
  assert.equal(autoParsed.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:17070");
  assert.equal(autoParsed.env.ANTHROPIC_AUTH_TOKEN, "bansos");
  // haiku takes the non-reasoning tier
  const haikuDef = SEEDED_MODELS.find((m) => m.id === autoParsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
  assert.ok(haikuDef && !haikuDef.reasoning);
  // sonnet and opus take reasoning tiers
  const sonnetDef = SEEDED_MODELS.find((m) => m.id === autoParsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  const opusDef = SEEDED_MODELS.find((m) => m.id === autoParsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL);
  assert.ok(sonnetDef && sonnetDef.reasoning);
  assert.ok(opusDef && opusDef.reasoning);

  // pinned mode overrides every tier
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
const OMP_CTX = {
  baseUrl: "http://127.0.0.1:17070/v1",
  defaultModel: "mimo-v2.6-flash-free",
  models: SEEDED_MODELS,
  specificModel: false,
};
const OMP_MARKERS: [string, string] = [`# ${START_MARKER}`, `# ${END_MARKER}`];

test("omp adapter renders a providers-nested yaml-block write", () => {
  const adapter = findAdapter("omp")!;
  assert.equal(adapter.wire, "chat");
  const write = adapter.render(OMP_CTX)[0]!;
  assert.equal(write.path, "~/.omp/agent/models.yml");
  assert.equal(write.mode, "yaml-block");
  assert.equal(write.yamlParent, "providers");
  // child is emitted at column 0; the writer owns the nesting
  assert.match(write.content, /^bansos:\n {2}name: bansos-router\n {2}baseUrl: "http:\/\/127\.0\.0\.1:17070\/v1"/);
  assert.deepEqual(adapter.undo(OMP_CTX), ["~/.omp/agent/models.yml"]);
});

test("omp on a fresh file creates providers: and nests bansos under it", () => {
  const { content } = findAdapter("omp")!.render(OMP_CTX)[0]!;
  const out = applyYamlBlockWrite("", content, OMP_MARKERS, "providers");
  assert.equal(
    out,
    `# ${START_MARKER}\n` +
      `providers:\n` +
      `  bansos:\n` +
      `    name: bansos-router\n` +
      `    baseUrl: "http://127.0.0.1:17070/v1"\n` +
      `    apiKey: bansos\n` +
      `    api: openai-completions\n` +
      `    discovery:\n` +
      `      type: openai-models-list\n` +
      `      timeoutMs: 15000\n` +
      `# ${END_MARKER}\n`,
  );
});

test("omp nests under an existing providers: that is not the last key", () => {
  const { content } = findAdapter("omp")!.render(OMP_CTX)[0]!;
  const existing = `providers:\n  openai:\n    apiKey: sk-xxx\ndefaults:\n  model: gpt-4\n`;
  const out = applyYamlBlockWrite(existing, content, OMP_MARKERS, "providers");
  // bansos sits under providers (2-space), openai is preserved, defaults stays top-level
  assert.equal(
    out,
    `providers:\n` +
      `  openai:\n` +
      `    apiKey: sk-xxx\n` +
      `  # ${START_MARKER}\n` +
      `  bansos:\n` +
      `    name: bansos-router\n` +
      `    baseUrl: "http://127.0.0.1:17070/v1"\n` +
      `    apiKey: bansos\n` +
      `    api: openai-completions\n` +
      `    discovery:\n` +
      `      type: openai-models-list\n` +
      `      timeoutMs: 15000\n` +
      `  # ${END_MARKER}\n` +
      `defaults:\n` +
      `  model: gpt-4\n`,
  );
});

test("omp write is idempotent and cleanly undoable", () => {
  const { content } = findAdapter("omp")!.render(OMP_CTX)[0]!;
  const original = `version: 1\nproviders:\n  openai:\n    apiKey: sk-xxx\n`;
  const once = applyYamlBlockWrite(original, content, OMP_MARKERS, "providers");
  const twice = applyYamlBlockWrite(once, content, OMP_MARKERS, "providers");
  assert.equal(twice, once, "re-run replaces the block instead of duplicating it");
  assert.equal(
    (once.match(new RegExp(START_MARKER, "g")) ?? []).length,
    1,
    "exactly one bansos block",
  );
  assert.equal(removeBlock(once, OMP_MARKERS), original, "undo restores the file byte-for-byte");
});

test("omp refuses a flow-style providers: instead of corrupting it", () => {
  const { content } = findAdapter("omp")!.render(OMP_CTX)[0]!;
  assert.throws(
    () => applyYamlBlockWrite(`providers: { openai: {} }\n`, content, OMP_MARKERS, "providers"),
    /inline "providers:"/,
  );
});

function codexWrite(model = "mimo-v2.6-flash-free") {
  return findAdapter("codex")!.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: model,
    models: SEEDED_MODELS,
    specificModel: true,
  })[0]!;
}

function rootValue(toml: string, key: string): string[] {
  const lines = toml.split("\n");
  const end = lines.findIndex((l) => /^\s*\[/.test(l));
  return lines.slice(0, end === -1 ? undefined : end).filter((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
}

test("codex setup overrides a user's own root model once and undo restores it", () => {
  const existing = ['model = "gpt-5"', 'approval_policy = "on-request"', "", "[mcp_servers.x]", 'command = "y"', ""].join("\n");
  const w = codexWrite();
  const once = applyTomlBlockWrite(existing, w.content, w.markers!, w.tomlTable!);
  const twice = applyTomlBlockWrite(once, codexWrite("big-pickle").content, w.markers!, w.tomlTable!);
  for (const out of [once, twice]) {
    assert.equal(rootValue(out, "model").length, 1, out);
    assert.equal(rootValue(out, "model_provider").length, 1, out);
    assert.equal(out.split("\n").filter((l) => l.trim() === "[model_providers.bansos]").length, 1);
  }
  assert.match(rootValue(twice, "model")[0]!, /big-pickle/);
  const undone = removeTomlBlock(twice, w.markers!);
  assert.deepEqual(rootValue(undone, "model"), ['model = "gpt-5"']);
  assert.equal(rootValue(undone, "model_provider").length, 0);
  assert.doesNotMatch(undone, /bansos/);
  assert.match(undone, /\[mcp_servers\.x\]/);
});

test("codex setup on a file whose first line is a table keeps root keys in root scope", () => {
  const w = codexWrite();
  const out = applyTomlBlockWrite('[profiles.a]\nmodel = "o3"\n', w.content, w.markers!, w.tomlTable!);
  assert.ok(out.indexOf("model_provider") < out.indexOf("[profiles.a]"));
  assert.equal(removeTomlBlock(out, w.markers!), '[profiles.a]\nmodel = "o3"\n');
});

test("jsonc trailing-comma cleanup never rewrites string contents", () => {
  const obj = parseJsonc('{ "cmd": "python -c \'print([1, 2, ])\'", "s": "a,}", "list": [1, 2,], }');
  assert.equal(obj.cmd, "python -c 'print([1, 2, ])'");
  assert.equal(obj.s, "a,}");
  assert.deepEqual(obj.list, [1, 2]);
});

function renderAll(id: string, models: Array<{ id: string; name?: string; contextWindow?: number }>) {
  return findAdapter(id)!.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: models[0]!.id,
    models: models as any,
    specificModel: false,
  })[0]!;
}

test("rerunning setup drops models that left the catalog instead of piling them up", () => {
  const before = [{ id: "old-a", name: "old-a" }, { id: "keep", name: "keep" }];
  const after = [{ id: "keep", name: "keep" }, { id: "new-b", name: "new-b" }];
  for (const id of ["opencode", "goose", "openclaw"]) {
    const w1 = renderAll(id, before);
    const user = id === "opencode" ? '{"theme":"dark"}' : null;
    const once = applyMergeWrite(user, w1.content, w1.replace);
    const w2 = renderAll(id, after);
    const twice = applyMergeWrite(once, w2.content, w2.replace);
    assert.doesNotMatch(twice, /old-a/, id);
    assert.match(twice, /new-b/, id);
    assert.equal(twice.match(/"keep"/g)?.length, 1, `${id} keeps one copy`);
    if (user) assert.match(twice, /"dark"/, `${id} keeps the user's own entries`);
  }
});


test("dsh harness writes one llm-pi-ai entry with the bansos provider", () => {
  const adapter = findAdapter("dsh");
  assert.ok(adapter);
  const write = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "glm-4.6",
    models: [{ id: "glm-4.6" }, { id: "kilo-auto/free" }] as any,
    specificModel: false,
  })[0]!;
  assert.equal(write.path, "~/.dsh/profiles/web/cordis.patch.yml");
  assert.match(write.content, /^- id: llm-pi-ai$/m);
  assert.match(write.content, /^ {8}baseURL: http:\/\/127\.0\.0\.1:17070\/v1$/m);
  assert.match(write.content, /^ {10}- id: kilo-auto\/free$/m);
  assert.match(write.content, /apiKeyEnv: BANSOS_API_KEY/);
  assert.match(write.content, /^ {10}x-bansos-client: dsh$/m);

  // terminal runs read the headless profile, so both get the same provider
  assert.deepEqual(
    adapter.render({ baseUrl: "http://127.0.0.1:17070/v1", defaultModel: "glm-4.6", models: [], specificModel: false }).map((w) => w.path),
    ["~/.dsh/profiles/web/cordis.patch.yml", "~/.dsh/profiles/headless/cordis.patch.yml", "~/.dsh/.env"],
  );
  assert.equal(adapter.undo({} as any).length, 3);
});

test("dsh setup splices the provider into an existing llm-pi-ai entry", () => {
  const ctx = {
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "glm-4.6",
    models: [{ id: "glm-4.6" }] as any,
    specificModel: false,
  };
  const existing = [
    "- id: llm-other",
    "  config:",
    "    x: 1",
    "- id: llm-pi-ai",
    "  config:",
    "    providers:",
    "      acme:",
    "        api: openai-completions",
    "        baseURL: https://acme.example/v1",
    "        models:",
    "          - id: acme-1",
    "    retryPolicy:",
    "      mode: normal",
    "- id: llm-deepseek-account",
    "  config: {}",
    "",
  ].join("\n");

  const merged = dshMergeProviders(existing, ctx);
  assert.equal(merged.status, "merged");
  if (merged.status !== "merged") return;

  // one llm-pi-ai entry only, the user's routes and the plugin fields survive
  assert.equal(merged.content.match(/- id: llm-pi-ai/g)?.length, 1);
  assert.match(merged.content, /^ {6}acme:$/m);
  assert.match(merged.content, /^ {4}retryPolicy:$/m);
  assert.match(merged.content, /^ {6}mode: normal$/m);
  assert.match(merged.content, /^ {6}bansos:$/m);
  assert.match(merged.content, /^ {8}models:\n {10}- id: glm-4\.6$/m);

  // rerunning finds its own provider and leaves the file alone
  assert.equal(dshMergeProviders(merged.content, ctx).status, "present");
});

test("dsh setup refuses to edit a file it cannot splice safely", () => {
  const ctx = { baseUrl: "http://127.0.0.1:17070/v1", defaultModel: "m", models: [{ id: "m" }] as any, specificModel: false };
  assert.equal(dshMergeProviders("- id: llm-pi-ai\n  config:\n    providers: { acme: {} }\n", ctx).status, "manual");
  assert.equal(dshMergeProviders("- id: llm-pi-ai\n  config:\n    other: 1\n", ctx).status, "manual");
  assert.equal(dshMergeProviders("- id: llm-other\n  config: {}\n", ctx).status, "no-entry");
});

test("removing a nested block keeps the indentation of what follows it", () => {
  const file = ["providers:", "  # bansos-router:start", "  bansos:", "    api: chat", "  # bansos-router:end", "  acme:", "    api: chat", ""].join("\n");
  const out = removeBlock(file, [`# ${START_MARKER}`, `# ${END_MARKER}`]);
  assert.match(out, /^ {2}acme:$/m);
});

test("dsh setup writes the key dsh insists on into $DSH_HOME/.env", () => {
  const adapter = findAdapter("dsh")!;
  const writes = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "big-pickle",
    models: SEEDED_MODELS,
    specificModel: false,
  });
  const envWrite = writes.find((w) => w.path.endsWith(".env"))!;
  assert.equal(envWrite.path, "~/.dsh/.env");
  assert.match(envWrite.content, /^BANSOS_API_KEY=bansos$/m);
  // the profiles stay untouched by the env write
  assert.equal(writes.filter((w) => w.path.endsWith("cordis.patch.yml")).length, 2);
  assert.equal(adapter.undo({} as any).length, 3);
});

test("dsh setup points its default model at the router", () => {
  const ctx = { baseUrl: "http://127.0.0.1:17070/v1", defaultModel: "glm-4.6", models: [], specificModel: false };
  const patched = dshEnsureDefaultModel("a: 1\n# bansos-router:end\n", ctx);
  assert.match(patched, /^- id: agent-default-model\n {2}config:\n {4}provider: bansos\n {4}model: glm-4\.6\n# bansos-router:end$/m);

  // a default model the user already set wins
  const own = "- id: agent-default-model\n  config:\n    provider: mine\n# bansos-router:end\n";
  assert.equal(dshEnsureDefaultModel(own, ctx), own);

  // no marker in the file: append
  assert.match(dshEnsureDefaultModel("- id: x\n", ctx), /^- id: agent-default-model$/m);
});
