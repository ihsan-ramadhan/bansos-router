import fs from "node:fs";
import { ADAPTERS } from "../adapters";
import { effectiveBind, effectivePort } from "../daemon/state";
import { START_MARKER } from "../adapters/types";
import { expandHome, parseJsonc } from "./write";
import { checkUpdate } from "../update";

export async function runDoctor(_argv: string[]): Promise<number> {
  const base = `http://${effectiveBind()}:${effectivePort()}`;
  let failures = 0;

  // 1. daemon reachable?
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json()) as { modelCount?: number; relay?: { enabled: boolean; url: string } };
    console.log(`✓ daemon      ok at ${base} (${body.modelCount ?? "?"} models)`);
    if (body.relay?.enabled && body.relay.url) {
      console.log(`✓ relay       on (${body.relay.url})`);
    } else {
      console.log(`· relay       disabled (direct)`);
    }
  } catch {
    console.error(`✗ daemon      not reachable at ${base}`);
    console.error(`  fix: run "bansos start" (or "bansosd") in another terminal`);
    failures++;
  }

  // 2. per-harness config files.
  for (const adapter of ADAPTERS) {
    const found = adapter.configPaths
      .map(expandHome)
      .find((p) => fs.existsSync(p));

    if (!found) {
      console.log(`· ${adapter.id.padEnd(12)} not configured (bansos setup ${adapter.id})`);
      continue;
    }
    const content = fs.readFileSync(found, "utf8");
    const configured = adapter.undoKeys
      ? hasKeys(content, adapter.undoKeys)
      : content.includes(START_MARKER);
    if (configured) {
      console.log(`✓ ${adapter.id.padEnd(12)} configured (${found})`);
    } else {
      console.log(`· ${adapter.id.padEnd(12)} file exists but no bansos config (${found})`);
    }
  }

  // 3. update available?
  const update = await checkUpdate();
  if (update.hasUpdate) {
    console.log(`\nUpdate available: ${update.current} -> ${update.latest} (run: npm i -g bansos-router)`);
  }

  return failures > 0 ? 1 : 0;
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
