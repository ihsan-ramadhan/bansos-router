import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  chooseModels,
  FETCH_TIMEOUT_MS,
  readCachedModels,
  toProviderModel,
  writeCachedModels,
  type ModelItem,
} from "./models.js";

const DEFAULT_PORT = 17070;
const STATE_FILE = path.join(os.homedir(), ".bansos", "state.json");

interface DaemonEndpoint {
  host: string;
  port: number;
}

interface DaemonState {
  pid?: number;
  port?: number;
  bind?: string;
}

function readDaemonState(): DaemonState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

// live port comes from state.json (the daemon auto-bumps a taken port)
function readEndpoint(): DaemonEndpoint {
  const state = readDaemonState();
  if (typeof state?.port !== "number") return { host: "127.0.0.1", port: DEFAULT_PORT };
  const bind = state.bind ?? "127.0.0.1";
  // a wildcard bind is an accept address, not something to dial
  const host = bind === "0.0.0.0" || bind === "::" || bind === "" ? "127.0.0.1" : bind;
  return { host, port: state.port };
}

let endpoint: DaemonEndpoint = { host: "127.0.0.1", port: DEFAULT_PORT };

const baseUrl = (e: DaemonEndpoint = endpoint) => `http://${e.host}:${e.port}/v1`;
const healthzUrl = (e: DaemonEndpoint = endpoint) => `http://${e.host}:${e.port}/healthz`;
const modelsUrl = (e: DaemonEndpoint = endpoint) => `http://${e.host}:${e.port}/v1/models`;
const EXTENSION_VERSION = "0.5.1";

function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

async function checkExtensionUpdate(): Promise<{ hasUpdate: boolean; latest: string; current: string }> {
  try {
    const res = await fetch("https://registry.npmjs.org/pi-bansos-router/latest", {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (data.version && isNewer(EXTENSION_VERSION, data.version)) {
        return { hasUpdate: true, latest: data.version, current: EXTENSION_VERSION };
      }
    }
  } catch {
    // ignore
  }
  return { hasUpdate: false, latest: EXTENSION_VERSION, current: EXTENSION_VERSION };
}

// pid of the daemon this extension started, so shutdown stops only that one
let spawnedDaemonPid: number | null = null;

async function isDaemonAlive(e: DaemonEndpoint = endpoint): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(healthzUrl(e), { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureDaemonRunning(): Promise<boolean> {
  endpoint = readEndpoint();
  if (await isDaemonAlive()) return true;

  try {
    const child = spawn("bansos", ["start", "--bg"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    const start = Date.now();
    while (Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 200));
      // re-read each tick: the spawned daemon may land on a bumped port, published in state.json
      endpoint = readEndpoint();
      if (await isDaemonAlive()) {
        spawnedDaemonPid = readDaemonState()?.pid ?? null;
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function fetchModelsOnce(e: DaemonEndpoint = endpoint): Promise<ModelItem[]> {
  try {
    const res = await fetch(modelsUrl(e), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: ModelItem[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

// a daemon that just started may still be seeding its catalog, so one retry
async function fetchModels(e: DaemonEndpoint = endpoint): Promise<ModelItem[]> {
  const first = await fetchModelsOnce(e);
  if (first.length > 0) return first;
  await new Promise((r) => setTimeout(r, 500));
  return fetchModelsOnce(e);
}


export default async function (pi: ExtensionAPI) {
  const daemonReady = await ensureDaemonRunning();

  const live = daemonReady ? await fetchModels() : [];
  if (live.length > 0) writeCachedModels(live);
  const models = chooseModels(live, readCachedModels());

  // pi resolves the baseUrl once; remember it so a port move does not strand the provider
  const registeredEndpoint = endpoint;

  pi.registerProvider("bansosr", {
    baseUrl: baseUrl(registeredEndpoint),
    apiKey: "bansos",
    api: "openai-completions",
    models: models.map(toProviderModel),
  });

  pi.registerCommand("bansosr", {
    description: "Check bansos router daemon status and models",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const alive = await isDaemonAlive(registeredEndpoint);
      if (!alive) {
        const current = readEndpoint();
        if (current.port !== registeredEndpoint.port && (await isDaemonAlive(current))) {
          ctx.ui.notify(
            `bansos daemon moved to port ${current.port}; this session still points at ${registeredEndpoint.port}. Restart pi to pick it up.`,
            "error",
          );
          return;
        }
        ctx.ui.notify("bansos daemon is NOT running. Try: bansos start", "error");
        return;
      }
      const liveModels = await fetchModels(registeredEndpoint);
      let relayInfo = "";
      try {
        const res = await fetch(healthzUrl(registeredEndpoint), { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const body = (await res.json()) as { relay?: { enabled: boolean; url: string } };
          if (body.relay?.enabled && body.relay.url) {
            relayInfo = `, relay: ${body.relay.url}`;
          } else {
            relayInfo = ", relay: off";
          }
        }
      } catch {
        // ignore
      }
      ctx.ui.notify(`pi-bansos-router v${EXTENSION_VERSION} · daemon online (${liveModels.length} models${relayInfo})`, "info");

      const update = await checkExtensionUpdate();
      if (update.hasUpdate) {
        ctx.ui.notify(`Update available for pi-bansos-router: ${update.current} -> ${update.latest} (run: pi update)`, "info");
      }
    },
  });

  // auto kill daemon only when pi completely quits, not on session switch (/resume /new)
  pi.on("session_shutdown", async (event) => {
    if (spawnedDaemonPid === null || event.reason !== "quit") return;
    // signal only our pid (not `bansos stop`, which scans all); re-check state.json for recycling
    if (readDaemonState()?.pid !== spawnedDaemonPid) return;
    try {
      process.kill(spawnedDaemonPid, "SIGTERM");
    } catch {
      // already gone
    }
  });
}
