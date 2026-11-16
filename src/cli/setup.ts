import fs from "node:fs";
import path from "node:path";
import { ADAPTERS, buildSetupContext, findAdapter, dshMergeProviders } from "../adapters";
import type { HarnessAdapter, SetupContext, ConfigWrite } from "../adapters/types";
import { END_MARKER } from "../adapters/types";
import { effectiveBind, effectivePort } from "../daemon/state";
import { SEEDED_MODELS } from "../upstreams";
import { modelDef, type ModelDef } from "../upstreams/types";
import {
  applyBlockWrite,
  applyMergeWrite,
  applyTomlBlockWrite,
  applyYamlBlockWrite,
  expandHome,
  parseJsonc,
  removeBlock,
  removeTomlBlock,
  removeKeys,
  writeConfig,
} from "./write";

interface SetupArgs {
  harnesses: string[];
  model?: string;
  models: string[];
  upstreams: string[];
  dryRun: boolean;
  undo: boolean;
}

const splitList = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function parseArgs(argv: string[]): SetupArgs {
  const args: SetupArgs = { harnesses: [], models: [], upstreams: [], dryRun: false, undo: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--model") args.model = argv[++i];
    else if (a === "--models") args.models.push(...splitList(argv[++i]));
    else if (a === "--upstream") args.upstreams.push(...splitList(argv[++i]));
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--undo") args.undo = true;
    else args.harnesses.push(a);
  }
  return args;
}

// first default_provider inside [provider]; jcode ignores it at root scope
function readProviderDefault(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  let inProvider = false;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      inProvider = header[1] === "provider";
      continue;
    }
    if (!inProvider) continue;
    const match = /^\s*default_provider\s*=\s*"([^"]*)"/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

function resolveTargetFile(adapter: HarnessAdapter, defaultPath: string): string {
  const fullDefault = expandHome(defaultPath);
  if (fs.existsSync(fullDefault)) return defaultPath;

  const found = adapter.configPaths
    .map(expandHome)
    .find((p) => fs.existsSync(p));
  if (found) {
    const matched = adapter.configPaths.find((cp) => expandHome(cp) === found);
    if (matched && path.extname(matched) === path.extname(defaultPath)) return matched;
  }
  return defaultPath;
}

async function getSetupModels(baseUrl: string): Promise<{ models: ModelDef[]; fromDaemon: boolean }> {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ id: string; source?: string; context_window?: number; max_tokens?: number; reasoning?: boolean; name?: string }>;
      };
      if (Array.isArray(json.data) && json.data.length > 0) {
        return { fromDaemon: true, models: json.data.map((m) => {
          const known = SEEDED_MODELS.find((s) => s.id === m.id);
          if (known) return known;
          return modelDef({
            id: m.id,
            name: m.name ?? m.id,
            source: (m.source ?? "zen") as ModelDef["source"],
            reasoning: m.reasoning ?? false,
            contextWindow: m.context_window ?? 256_000,
            maxTokens: m.max_tokens ?? 32_000,
            input: ["text"],
            compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
          });
        }) };
      }
    }
  } catch {
    // daemon offline or unreachable, fall back to seeded offline list
  }
  return { models: SEEDED_MODELS, fromDaemon: false };
}

function update9RouterSqlite(dbPath: string, ctx: SetupContext): boolean {
  const now = new Date().toISOString();
  const nodeId = "openai-compatible-chat-bansos";
  const nodeData = JSON.stringify({
    prefix: "bansos",
    apiType: "chat",
    baseUrl: ctx.baseUrl,
    name: "Bansos Router",
  });
  const connId = "bansos-default";
  const connData = JSON.stringify({
    apiKey: "bansos",
    prefix: "bansos",
    apiType: "chat",
    baseUrl: ctx.baseUrl,
    nodeName: "Bansos Router",
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteMod = (globalThis as any).process?.getBuiltinModule?.("node:sqlite");
    if (!sqliteMod?.DatabaseSync) return false;
    const db = new sqliteMod.DatabaseSync(dbPath);
    db.prepare(
      "INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)",
    ).run(nodeId, "openai-compatible", "Bansos Router", nodeData, now, now);

    db.prepare(
      "INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(connId, nodeId, "api_key", "Bansos Router", null, 1, 1, connData, now, now);

    db.close();
    return true;
  } catch {
    return false;
  }
}

function undo9RouterSqlite(dbPath: string): boolean {
  const nodeId = "openai-compatible-chat-bansos";
  const connId = "bansos-default";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteMod = (globalThis as any).process?.getBuiltinModule?.("node:sqlite");
    if (!sqliteMod?.DatabaseSync) return false;
    const db = new sqliteMod.DatabaseSync(dbPath);
    db.prepare("DELETE FROM providerNodes WHERE id = ?").run(nodeId);
    db.prepare("DELETE FROM providerConnections WHERE id = ?").run(connId);
    db.close();
    return true;
  } catch {
    return false;
  }
}

export type SetupLine = { kind: "ok" | "removed" | "skip" | "error"; text: string };
export type SetupReport = (line: SetupLine) => void;

const SETUP_SYMBOL: Record<SetupLine["kind"], string> = { ok: "✓", removed: "✗", skip: "·", error: "✗" };

function printSetupLine(line: SetupLine): void {
  const out = `  ${SETUP_SYMBOL[line.kind]} ${line.text}`;
  if (line.kind === "error") console.error(out);
  else console.log(out);
}

// dsh keeps one llm-pi-ai entry per profile, so the provider is spliced into it instead of appended
function applyDeepseek(adapter: HarnessAdapter, ctx: SetupContext, report: SetupReport): number {
  let failures = 0;
  for (const write of adapter.render(ctx)) {
    failures += applyDeepseekProfile(write, ctx, report);
  }
  return failures;
}

function applyDeepseekProfile(write: ConfigWrite, ctx: SetupContext, report: SetupReport): number {
  // dsh has one real path per profile: never redirect a profile write elsewhere
  const targetPath = write.path;
  const fullPath = expandHome(targetPath);
  const existing = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null;
  const stripped = existing ? removeBlock(existing, write.markers!) : "";

  if (targetPath.endsWith(".env")) {
    writeConfig(targetPath, applyBlockWrite(stripped, write.content, write.markers!));
    report({ kind: "ok", text: `wrote ${targetPath} (BANSOS_API_KEY, any value: the router checks none)` });
    return 0;
  }

  const merge = dshMergeProviders(stripped, ctx);

  if (merge.status === "merged") {
    writeConfig(targetPath, dshEnsureDefaultModel(merge.content, ctx));
    report({ kind: "ok", text: `wrote ${targetPath} (bansos provider inside the existing llm-pi-ai entry)` });
    return 0;
  }
  if (merge.status === "present") {
    report({ kind: "skip", text: `${targetPath}: llm-pi-ai already serves a bansos provider` });
    return 0;
  }
  if (merge.status === "manual") {
    report({ kind: "error", text: `${targetPath}: llm-pi-ai providers are not a block mapping, add the bansos provider by hand` });
    report({ kind: "error", text: `bansos setup dsh --dry-run prints the block to paste` });
    return 1;
  }

  writeConfig(targetPath, dshEnsureDefaultModel(applyBlockWrite(stripped, write.content, write.markers!), ctx));
  report({ kind: "ok", text: `wrote ${targetPath}` });
  return 0;
}

// without this entry dsh keeps answering from deepseek-official, which needs a key the user may not have
export function dshEnsureDefaultModel(content: string, ctx: SetupContext): string {
  if (/^\s*-\s*id:\s*['"]?agent-default-model['"]?\s*$/m.test(content)) return content;
  const entry = ["- id: agent-default-model", "  config:", "    provider: bansos", `    model: ${ctx.defaultModel}`];
  const lines = content.split("\n");
  const end = lines.findIndex((l) => l.trim() === `# ${END_MARKER}`);
  if (end === -1) return `${content.replace(/\n*$/, "\n")}${entry.join("\n")}\n`;
  lines.splice(end, 0, ...entry);
  return lines.join("\n");
}

const CONTINUE_HEADER = "name: bansos-router\nversion: 0.0.1\nschema: v1\n";

export function applyAdapter(adapter: HarnessAdapter, ctx: SetupContext, report: SetupReport = printSetupLine): number {
  if (adapter.id === "dsh") return applyDeepseek(adapter, ctx, report);
  if (adapter.id === "continue") return applyContinue(adapter, ctx, report);
  // setup never overwrites a provider the user already selected, so say what stayed
  const keptDefault =
    adapter.id === "jcode" ? readProviderDefault(expandHome(adapter.configPaths[0]!)) : undefined;
  let failed = 0;
  for (const write of adapter.render(ctx)) {
    const targetPath = resolveTargetFile(adapter, write.path);
    const fullPath = expandHome(targetPath);
    const existing = fs.existsSync(fullPath)
      ? fs.readFileSync(fullPath, "utf8")
      : null;
    let content: string;
    if (write.mode === "merge") {
      try {
        content = applyMergeWrite(existing, write.content, write.replace);
      } catch {
        report({ kind: "error", text: `${targetPath}: existing file is not valid JSON, skipping` });
        failed++;
        continue;
      }
    } else if (write.mode === "toml-block") {
      content = applyTomlBlockWrite(existing ?? "", write.content, write.markers!, write.tomlTable!, write.fillOnly ?? false);
    } else if (write.mode === "yaml-block") {
      try {
        content = applyYamlBlockWrite(existing ?? "", write.content, write.markers!, write.yamlParent!);
      } catch (err) {
        report({ kind: "error", text: `${targetPath}: ${(err as Error).message}` });
        failed++;
        continue;
      }
    } else {
      content = applyBlockWrite(existing ?? "", write.content, write.markers!);
    }
    writeConfig(targetPath, content);
    report({ kind: "ok", text: `wrote ${targetPath}` });
  }

  if (keptDefault && keptDefault !== "bansos") {
    report({
      kind: "skip",
      text: `${adapter.configPaths[0]}: kept default_provider = "${keptDefault}"; pick bansos with /model`,
    });
  }

  if (adapter.id === "9router") {
    const sqlitePath = expandHome("~/.9router/db/data.sqlite");
    if (fs.existsSync(sqlitePath)) {
      if (update9RouterSqlite(sqlitePath, ctx)) report({ kind: "ok", text: "updated ~/.9router/db/data.sqlite" });
      else report({ kind: "error", text: "~/.9router/db/data.sqlite: needs node:sqlite (Node >= 22.5)" });
    }
  }

  return failed;
}

// a config.yaml without the header fails continue's schema check, so a fresh file gets one first
function applyContinue(adapter: HarnessAdapter, ctx: SetupContext, report: SetupReport): number {
  let failures = 0;
  for (const write of adapter.render(ctx)) {
    const targetPath = write.path;
    const fullPath = expandHome(targetPath);
    const existing = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
    if (existing.trim() === "" && !fs.existsSync(fullPath)) report({ kind: "ok", text: `${targetPath}: created with a schema header` });
    const seeded = existing.trim() === "" ? CONTINUE_HEADER : existing;
    try {
      writeConfig(targetPath, applyYamlBlockWrite(seeded, write.content, write.markers!, write.yamlParent!));
      report({ kind: "ok", text: `wrote ${targetPath}` });
    } catch (err) {
      report({ kind: "error", text: `${targetPath}: ${(err as Error).message}` });
      failures++;
    }
  }
  return failures;
}

export function undoAdapter(adapter: HarnessAdapter, ctx: SetupContext, report: SetupReport = printSetupLine): void {
  const candidatePaths = Array.from(new Set([...adapter.configPaths, ...adapter.undo(ctx)]));
  for (const writePath of candidatePaths) {
    const full = expandHome(writePath);
    if (!fs.existsSync(full)) {
      continue;
    }

    if (writePath.endsWith(".sqlite")) {
      continue;
    }

    const existing = fs.readFileSync(full, "utf8");

    if (adapter.undoKeys) {
      let obj: Record<string, unknown>;
      try {
        obj = parseJsonc(existing);
      } catch {
        report({ kind: "skip", text: `${writePath} not valid JSON, skipping` });
        continue;
      }
      removeKeys(obj, adapter.undoKeys);
      if (Object.keys(obj).length === 0) {
        fs.rmSync(full);
        report({ kind: "removed", text: `removed ${writePath}` });
      } else {
        writeConfig(writePath, `${JSON.stringify(obj, null, 2)}\n`);
        report({ kind: "removed", text: `${writePath}: bansos keys removed` });
      }
    } else {
      const first = adapter.render(ctx)[0];
      const markers = first?.markers;
      if (markers) {
        const marked = first.mode === "toml-block" && writePath.endsWith(".toml")
          ? removeTomlBlock(existing, markers)
          : removeBlock(existing, markers);
        // the harness may have rewritten the file without our comments
        const out = marked === existing && adapter.undoContent ? adapter.undoContent(existing) : marked;
        if (out === existing) {
          report({ kind: "skip", text: `${writePath}: no bansos block found` });
        } else {
          writeConfig(writePath, out);
          report({ kind: "removed", text: `${writePath}: bansos block removed` });
        }
      }
    }
  }

  if (adapter.id === "9router") {
    const sqlitePath = expandHome("~/.9router/db/data.sqlite");
    if (fs.existsSync(sqlitePath)) {
      if (undo9RouterSqlite(sqlitePath)) report({ kind: "removed", text: "~/.9router/db/data.sqlite: bansos keys removed" });
      else report({ kind: "error", text: "~/.9router/db/data.sqlite: needs node:sqlite (Node >= 22.5)" });
    }
  }
}

export async function runSetup(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.harnesses.length === 0) {
    console.error("bansos setup: specify at least one harness (see --help)");
    return 1;
  }

  const baseUrl = `http://${effectiveBind()}:${effectivePort()}/v1`;
  const { models, fromDaemon } = await getSetupModels(baseUrl);
  const pinned = args.model;
  if (pinned && fromDaemon && !models.some((m) => m.id === pinned || m.id.endsWith(`/${pinned}`))) {
    console.warn(`bansos setup: "${pinned}" is not served by the daemon right now (not alive, or blocked by strict mode); writing it anyway`);
  }
  const ctx = buildSetupContext(baseUrl, models, { model: pinned, models: args.models, upstreams: args.upstreams });
  if ("error" in ctx) {
    console.error(`bansos setup: ${ctx.error}`);
    return 1;
  }

  let failed = 0;
  for (const id of args.harnesses) {
    const adapter = findAdapter(id);
    if (!adapter) {
      console.error(`bansos setup: unknown harness "${id}" (see --help)`);
      failed++;
      continue;
    }
    console.log(`\n${adapter.name} (${adapter.wire}):`);
    if (args.undo) {
      undoAdapter(adapter, ctx);
    } else if (args.dryRun) {
      for (const write of adapter.render(ctx)) {
        const targetPath = resolveTargetFile(adapter, write.path);
        console.log(`  -> ${targetPath}`);
        console.log(write.content.replace(/^/gm, "    "));
      }
    } else {
      failed += applyAdapter(adapter, ctx);
    }
  }

  return failed > 0 ? 1 : 0;
}
