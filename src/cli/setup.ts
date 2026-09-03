import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ADAPTERS, findAdapter } from "../adapters";
import type { HarnessAdapter, SetupContext } from "../adapters/types";
import { loadConfig } from "../daemon/state";
import { SEEDED_MODELS } from "../upstreams";
import { modelDef, pickSmartDefaultModel, type ModelDef } from "../upstreams/types";
import {
  applyBlockWrite,
  applyMergeWrite,
  applyTomlBlockWrite,
  expandHome,
  parseJsonc,
  removeBlock,
  removeKeys,
  writeConfig,
} from "./write";

interface SetupArgs {
  harnesses: string[];
  model?: string;
  dryRun: boolean;
  undo: boolean;
}

function parseArgs(argv: string[]): SetupArgs {
  const args: SetupArgs = { harnesses: [], dryRun: false, undo: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--model") args.model = argv[++i];
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

async function getSetupModels(baseUrl: string): Promise<ModelDef[]> {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ id: string; context_window?: number; max_tokens?: number; reasoning?: boolean; name?: string }>;
      };
      if (Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map((m) => {
          const known = SEEDED_MODELS.find((s) => s.id === m.id);
          if (known) return known;
          return modelDef({
            id: m.id,
            name: m.name ?? m.id,
            source: "zen",
            reasoning: m.reasoning ?? false,
            contextWindow: m.context_window ?? 256_000,
            maxTokens: m.max_tokens ?? 32_000,
            input: ["text"],
            compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
          });
        });
      }
    }
  } catch {
    // daemon offline or unreachable, fall back to seeded offline list
  }
  return SEEDED_MODELS;
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
    if (sqliteMod?.DatabaseSync) {
      const db = new sqliteMod.DatabaseSync(dbPath);
      db.prepare(
        "INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)",
      ).run(nodeId, "openai-compatible", "Bansos Router", nodeData, now, now);

      db.prepare(
        "INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(connId, nodeId, "api_key", "Bansos Router", null, 1, 1, connData, now, now);

      db.close();
      return true;
    }
  } catch {
    // Fall through to sqlite3 CLI
  }

  try {
    const sql = [
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES('${nodeId}', 'openai-compatible', 'Bansos Router', '${nodeData.replace(/'/g, "''")}', '${now}', '${now}');`,
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES('${connId}', '${nodeId}', 'api_key', 'Bansos Router', NULL, 1, 1, '${connData.replace(/'/g, "''")}', '${now}', '${now}');`,
    ].join("\n");
    const res = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
    return res.status === 0;
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
    if (sqliteMod?.DatabaseSync) {
      const db = new sqliteMod.DatabaseSync(dbPath);
      db.prepare("DELETE FROM providerNodes WHERE id = ?").run(nodeId);
      db.prepare("DELETE FROM providerConnections WHERE id = ?").run(connId);
      db.close();
      return true;
    }
  } catch {
    // Fall through to sqlite3 CLI
  }

  try {
    const sql = [
      `DELETE FROM providerNodes WHERE id = '${nodeId}';`,
      `DELETE FROM providerConnections WHERE id = '${connId}';`,
    ].join("\n");
    const res = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
    return res.status === 0;
  } catch {
    return false;
  }
}

function applyAdapter(adapter: HarnessAdapter, ctx: SetupContext): number {
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
        content = applyMergeWrite(existing, write.content);
      } catch {
        console.error(`  ✗ ${targetPath}: existing file is not valid JSON, skipping`);
        failed++;
        continue;
      }
    } else if (write.mode === "toml-block") {
      content = applyTomlBlockWrite(existing ?? "", write.content, write.markers!, write.tomlTable!);
    } else {
      content = applyBlockWrite(existing ?? "", write.content, write.markers!);
    }
    writeConfig(targetPath, content);
    console.log(`  ✓ wrote ${targetPath}`);
  }

  if (adapter.id === "9router") {
    const sqlitePath = expandHome("~/.9router/db/data.sqlite");
    if (fs.existsSync(sqlitePath) && update9RouterSqlite(sqlitePath, ctx)) {
      console.log("  ✓ updated ~/.9router/db/data.sqlite");
    }
  }

  return failed;
}

function undoAdapter(adapter: HarnessAdapter, ctx: SetupContext): void {
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
        console.log(`  · ${writePath} not valid JSON, skipping`);
        continue;
      }
      removeKeys(obj, adapter.undoKeys);
      if (Object.keys(obj).length === 0) {
        fs.rmSync(full);
        console.log(`  ✗ removed ${writePath}`);
      } else {
        writeConfig(writePath, `${JSON.stringify(obj, null, 2)}\n`);
        console.log(`  ✗ ${writePath}: bansos keys removed`);
      }
    } else {
      const markers = adapter.render(ctx)[0]?.markers;
      if (markers) {
        const out = removeBlock(existing, markers);
        if (out === existing) {
          console.log(`  · ${writePath}: no bansos block found`);
        } else {
          writeConfig(writePath, out);
          console.log(`  ✗ ${writePath}: bansos block removed`);
        }
      }
    }
  }

  if (adapter.id === "9router") {
    const sqlitePath = expandHome("~/.9router/db/data.sqlite");
    if (fs.existsSync(sqlitePath) && undo9RouterSqlite(sqlitePath)) {
      console.log("  ✗ ~/.9router/db/data.sqlite: bansos keys removed");
    }
  }
}

export async function runSetup(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.harnesses.length === 0) {
    console.error("bansos setup: specify at least one harness (see --help)");
    return 1;
  }

  const config = loadConfig();
  const baseUrl = `http://${config.bind}:${config.port}/v1`;
  const models = await getSetupModels(baseUrl);
  const defaultModel = args.model ?? pickSmartDefaultModel(models);
  const ctx: SetupContext = {
    baseUrl,
    defaultModel,
    models,
    specificModel: Boolean(args.model),
  };

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
