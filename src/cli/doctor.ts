import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ADAPTERS } from "../adapters";
import { readClientApiKey } from "../daemon/auth";
import { API_KEY_FILE, effectiveBind, effectivePort, loadConfig, loadConfigWarnings } from "../daemon/state";
import { daemonFetch } from "./daemon-fetch";
import { KEY_EXPORT_HINT } from "./key";
import { START_MARKER } from "../adapters/types";
import { expandHome, parseJsonc } from "./write";
import { checkUpdate } from "../update";
import { autostartStatus } from "./autostart";

export async function runDoctor(_argv: string[]): Promise<number> {
  const base = `http://${effectiveBind()}:${effectivePort()}`;
  let failures = 0;

  // the key harness configs are compared against; unset when it cannot be trusted
  let clientKey: string | undefined;
  let keyError: string | null = null;
  try {
    clientKey = readClientApiKey() ?? undefined;
  } catch (err) {
    keyError = (err as Error).message;
  }

  // 1. daemon reachable? /healthz needs no key, /bansos/status does
  let reachable = false;
  try {
    reachable = (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    // reported below
  }
  if (!reachable) {
    console.error(`✗ daemon      not reachable at ${base}`);
    console.error(`  fix: run "bansos start" (or "bansosd") in another terminal`);
    failures++;
  } else if (keyError) {
    console.log(`✓ daemon      ok at ${base}`);
  } else {
    try {
      const res = await daemonFetch(`${base}/bansos/status`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 401) {
        console.log(`✓ daemon      ok at ${base}`);
        console.error(`✗ auth        the daemon rejected this machine's API key`);
        console.error(`  fix: set BANSOS_API_KEY to the daemon's key, or restart the daemon so it uses ${API_KEY_FILE} (bansos stop; bansos start --bg)`);
        failures++;
        clientKey = undefined;
      } else {
        const body = (await res.json()) as {
          modelCount?: number;
          relay?: { enabled: boolean; url: string };
          auth?: { required: boolean };
        };
        console.log(`✓ daemon      ok at ${base} (${body.modelCount ?? "?"} models)`);
        if (body.auth?.required === false) {
          console.log(`· auth        off (BANSOS_AUTH=off, loopback only)`);
          // harnesses hold the placeholder key then, which is fine
          clientKey = undefined;
        } else {
          console.log(`✓ auth        API key accepted`);
        }
        if (body.relay?.enabled && body.relay.url) {
          console.log(`✓ relay       on (${body.relay.url})`);
        } else {
          console.log(`· relay       disabled (direct)`);
        }
      }
    } catch {
      console.log(`✓ daemon      ok at ${base} (status unavailable)`);
    }
  }
  if (keyError) {
    console.error(`✗ auth        ${keyError}`);
    failures++;
  }

  const warnings = loadConfigWarnings();
  if (warnings.length > 0) {
    for (const w of warnings) console.error(`✗ security    ${w}`);
    failures++;
  } else {
    const { mode, dlp } = loadConfig().security;
    console.log(`✓ security    ${mode} mode${mode === "strict" ? ` (dlp: ${dlp})` : ""}`);
  }

  const autostart = autostartStatus();
  if (autostart.broken) {
    console.error(`✗ autostart   points at a path that no longer exists (run: bansos autostart on)`);
    failures++;
  } else if (autostart.enabled) {
    console.log(`✓ autostart   on (${autostart.manager})`);
  } else {
    console.log(`· autostart   off${autostart.supported ? " (bansos autostart on)" : ""}`);
  }
  // zen models readiness
  const whichCmd = process.platform === "win32" ? "where" : "which";
  let hasOpenCode = false;
  try {
    hasOpenCode = spawnSync(whichCmd, ["opencode"], { encoding: "utf-8", timeout: 1000 }).status === 0;
  } catch {}
  const hasBun = "Bun" in globalThis || (() => {
    try {
      if (spawnSync(whichCmd, ["bun"], { encoding: "utf-8", timeout: 1000 }).status === 0) return true;
    } catch {}
    const binName = process.platform === "win32" ? "bun.exe" : "bun";
    const candidates = [
      path.join(os.homedir(), ".bun", "bin", binName),
      "/usr/local/bin/bun",
      "/usr/bin/bun",
    ];
    return candidates.some((c) => fs.existsSync(c));
  })();
  if (hasOpenCode) {
    console.log(`✓ opencode    installed (Zen free models ready)`);
  } else if (hasBun) {
    console.log(`✓ runtime     bun detected (Zen free models ready)`);
  } else {
    console.log(`· opencode    not installed (Zen models require opencode or bun; Kilo/LLM7/OVH work directly)`);
  }


  // 2. per-harness config files.
  for (const h of harnessStatuses(clientKey)) {
    if (h.status === "missing") {
      console.log(`· ${h.id.padEnd(12)} not configured (bansos setup ${h.id})`);
    } else if (h.status === "configured" && h.key === "stale") {
      console.error(`✗ ${h.id.padEnd(12)} configured but its API key does not match the daemon's (fix: bansos setup ${h.id})`);
      failures++;
    } else if (h.status === "configured" && h.key === "env") {
      console.log(`✓ ${h.id.padEnd(12)} configured (reads BANSOS_API_KEY from the environment)`);
      if (process.env.BANSOS_API_KEY === undefined) {
        console.log(`  hint: BANSOS_API_KEY is not set in this shell; export it where ${h.id} runs: ${KEY_EXPORT_HINT}`);
      }
    } else if (h.status === "configured") {
      console.log(`✓ ${h.id.padEnd(12)} configured (${h.path})`);
    } else {
      console.log(`· ${h.id.padEnd(12)} file exists but no bansos config (${h.path})`);
    }
  }

  // 3. update available?
  const update = await checkUpdate();
  if (update.hasUpdate) {
    console.log(`\nUpdate available: ${update.current} -> ${update.latest} (run: npm i -g bansos-router)`);
  }

  return failures > 0 ? 1 : 0;
}

export type HarnessStatus = {
  id: string;
  status: "configured" | "unconfigured" | "missing";
  path?: string;
  // configured text configs only: does the file hold the daemon's current key (env: harness reads it from env)
  key?: "ok" | "stale" | "env";
};

// a status check reads the whole file on the event loop, so anything bigger is not a config
const MAX_TEXT_CONFIG_BYTES = 8 << 20;

export function harnessStatuses(apiKey?: string): HarnessStatus[] {
  return ADAPTERS.map((adapter) => {
    const found = adapter.configPaths.map(expandHome).find((p) => fs.existsSync(p));
    if (!found) return { id: adapter.id, status: "missing" };

    if (found.endsWith(".sqlite")) {
      const configured = adapter.undoKeys ? sqliteKeysExist(found, adapter.undoKeys) : false;
      return { id: adapter.id, status: configured ? "configured" : "unconfigured", path: found };
    }

    let content = "";
    try {
      if (fs.statSync(found).size > MAX_TEXT_CONFIG_BYTES) {
        return { id: adapter.id, status: "unconfigured", path: found };
      }
      content = fs.readFileSync(found, "utf8");
    } catch {
      return { id: adapter.id, status: "unconfigured", path: found };
    }
    if (content.includes("\u0000")) {
      return { id: adapter.id, status: "unconfigured", path: found };
    }
    const configured = adapter.undoKeys ? hasKeys(content, adapter.undoKeys) : content.includes(START_MARKER);
    if (!configured) return { id: adapter.id, status: "unconfigured", path: found };
    if (apiKey === undefined) return { id: adapter.id, status: "configured", path: found };
    const key = adapter.keyEnv ? "env" : holdsKey(adapter.configPaths, found, content, apiKey) ? "ok" : "stale";
    return { id: adapter.id, status: "configured", path: found, key };
  });
}

// the key can sit in a sibling file bansos also wrote (jcode keeps it in its .env, not config.toml)
function holdsKey(configPaths: string[], found: string, content: string, apiKey: string): boolean {
  if (content.includes(apiKey)) return true;
  return configPaths.map(expandHome).some((p) => {
    if (p === found || p.endsWith(".sqlite")) return false;
    try {
      if (!fs.existsSync(p) || fs.statSync(p).size > MAX_TEXT_CONFIG_BYTES) return false;
      const sibling = fs.readFileSync(p, "utf8");
      return sibling.includes(START_MARKER) && sibling.includes(apiKey);
    } catch {
      return false;
    }
  });
}

// undo keys are "<table>.<id>" pairs; a row hit means the harness was set up
function sqliteKeysExist(dbPath: string, keys: string[]): boolean {
  const valid = keys
    .map((k) => k.split("."))
    .filter(([table, id]) => Boolean(table && id && /^[A-Za-z_]\w*$/.test(table)));
  if (valid.length === 0) return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteMod = (globalThis as any).process?.getBuiltinModule?.("node:sqlite");
    if (sqliteMod?.DatabaseSync) {
      const db = new sqliteMod.DatabaseSync(dbPath, { readOnly: true });
      try {
        return valid.some(([table, id]) =>
          Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)),
        );
      } finally {
        db.close();
      }
    }
  } catch {
    // not a readable database (or no sqlite support in this runtime): report unconfigured
  }
  return false;
}

function hasKeys(content: string, keys: string[]): boolean {
  try {
    const obj = parseJsonc(content);
    const first = keys[0];
    if (!first) return false;
    let cur: unknown = obj;
    for (const p of first.split(".")) {
      const match = p.endsWith("*")
        ? (k: unknown) => typeof k === "string" && k.startsWith(p.slice(0, -1))
        : (k: unknown) => k === p;
      if (Array.isArray(cur)) {
        cur = cur.find((item) => {
          const rec = item as Record<string, unknown> | null;
          return rec && typeof rec === "object" && match(rec.id ?? rec.title ?? rec.model);
        });
      } else if (cur && typeof cur === "object") {
        const k = Object.keys(cur).find(match);
        cur = k === undefined ? undefined : (cur as Record<string, unknown>)[k];
      } else {
        cur = undefined;
      }
      if (cur === undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}
