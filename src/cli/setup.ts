import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { ADAPTERS, buildSetupContext, findAdapter } from "../adapters";
import type { HarnessAdapter, SetupContext } from "../adapters/types";
import { AUTH_KEY_PLACEHOLDER, AUTH_OFF_KEY, resolveApiKey } from "../daemon/auth";
import { effectiveBind, effectivePort } from "../daemon/state";
import { SEEDED_MODELS } from "../upstreams";
import { ClientKeyError, daemonFetch } from "./daemon-fetch";
import { KEY_EXPORT_HINT } from "./key";
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

async function getSetupModels(
  baseUrl: string,
): Promise<{ models: ModelDef[]; fromDaemon: boolean; keyRejected: boolean }> {
  try {
    const res = await daemonFetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(800) });
    // a running daemon refusing this key: harnesses written with it would get the same 401
    if (res.status === 401) return { models: SEEDED_MODELS, fromDaemon: false, keyRejected: true };
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ id: string; source?: string; context_window?: number; max_tokens?: number; reasoning?: boolean; name?: string }>;
      };
      if (Array.isArray(json.data) && json.data.length > 0) {
        return { fromDaemon: true, keyRejected: false, models: json.data.map((m) => {
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
  } catch (err) {
    if (err instanceof ClientKeyError) throw err;
    // daemon offline or unreachable, fall back to seeded offline list
  }
  return { models: SEEDED_MODELS, fromDaemon: false, keyRejected: false };
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
    apiKey: ctx.apiKey,
    prefix: "bansos",
    apiType: "chat",
    baseUrl: ctx.baseUrl,
    nodeName: "Bansos Router",
  });

  try {
    const db = new Database(dbPath);
    try {
      db.prepare(
        "INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)",
      ).run(nodeId, "openai-compatible", "Bansos Router", nodeData, now, now);

      db.prepare(
        "INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(connId, nodeId, "api_key", "Bansos Router", null, 1, 1, connData, now, now);
    } finally {
      db.close();
    }
    return true;
  } catch {
    return false;
  }
}

function undo9RouterSqlite(dbPath: string): boolean {
  const nodeId = "openai-compatible-chat-bansos";
  const connId = "bansos-default";
  try {
    const db = new Database(dbPath);
    try {
      db.prepare("DELETE FROM providerNodes WHERE id = ?").run(nodeId);
      db.prepare("DELETE FROM providerConnections WHERE id = ?").run(connId);
    } finally {
      db.close();
    }
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

export function applyAdapter(adapter: HarnessAdapter, ctx: SetupContext, report: SetupReport = printSetupLine): number {
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
      content = applyTomlBlockWrite(existing ?? "", write.content, write.markers!, write.tomlTable!);
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
    // a new file that holds the router key is created owner-only, like the api-key file
    const holdsKey = ctx.apiKey !== AUTH_OFF_KEY && ctx.apiKey !== AUTH_KEY_PLACEHOLDER && content.includes(ctx.apiKey);
    writeConfig(targetPath, content, holdsKey ? 0o600 : undefined);
    report({ kind: "ok", text: `wrote ${targetPath}` });
  }

  if (adapter.id === "9router") {
    const sqlitePath = expandHome("~/.9router/db/data.sqlite");
    if (fs.existsSync(sqlitePath) && update9RouterSqlite(sqlitePath, ctx)) {
      report({ kind: "ok", text: "updated ~/.9router/db/data.sqlite" });
    }
  }

  return failed;
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
        const out = first.mode === "toml-block" && writePath.endsWith(".toml")
          ? removeTomlBlock(existing, markers)
          : removeBlock(existing, markers);
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
    if (fs.existsSync(sqlitePath) && undo9RouterSqlite(sqlitePath)) {
      report({ kind: "removed", text: "~/.9router/db/data.sqlite: bansos keys removed" });
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
  // dry runs and undo never need (or show) the real key; resolved before the model fetch so both use the same key
  const writes = !args.dryRun && !args.undo;
  let apiKey = AUTH_KEY_PLACEHOLDER;
  let keyLine = "";
  if (writes) {
    try {
      const resolved = resolveApiKey({ generate: true })!;
      apiKey = resolved.key;
      keyLine = resolved.source === "env"
        ? "API key: from BANSOS_API_KEY"
        : `API key: ${resolved.file} (show it with: bansos key)`;
    } catch (err) {
      console.error(`bansos setup: ${(err as Error).message}`);
      return 1;
    }
  }
  let setupModels: Awaited<ReturnType<typeof getSetupModels>>;
  try {
    setupModels = await getSetupModels(baseUrl);
  } catch (err) {
    console.error(`bansos setup: ${(err as Error).message}`);
    return 1;
  }
  const { models, fromDaemon, keyRejected } = setupModels;
  const pinned = args.model;
  if (pinned && fromDaemon && !models.some((m) => m.id === pinned || m.id.endsWith(`/${pinned}`))) {
    console.warn(`bansos setup: "${pinned}" is not served by the daemon right now (not alive, or blocked by strict mode); writing it anyway`);
  }
  if (keyLine) console.log(keyLine);
  if (writes && keyRejected) {
    console.warn(
      `bansos setup: warning: the daemon at ${baseUrl.replace(/\/v1$/, "")} rejects this API key, so harnesses set up now will get 401 ` +
        `(set BANSOS_API_KEY to the daemon's key, or restart the daemon: bansos stop; bansos start --bg)`,
    );
  }
  const ctx = buildSetupContext(baseUrl, models, { model: pinned, models: args.models, upstreams: args.upstreams }, apiKey);
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
    if (!args.undo && adapter.keyEnv) {
      console.log(`  · ${adapter.name} reads the key from ${adapter.keyEnv}; export it where ${adapter.id} runs: ${KEY_EXPORT_HINT}`);
    }
  }

  return failed > 0 ? 1 : 0;
}
