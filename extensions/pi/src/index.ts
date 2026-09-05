import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

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

// the daemon auto-bumps its port when the configured one is taken (17070 ->
// 17071 -> ...), so the live port comes from state.json, not a constant.
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
const EXTENSION_VERSION = "0.2.4";

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

interface ModelItem {
  id: string;
  name?: string;
  context_window?: number;
  max_tokens?: number;
  reasoning?: boolean;
}

// pid of the daemon this extension started, so shutdown can stop that one
// instead of every daemon on the machine
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
      // re-read every tick: the daemon we just spawned may land on a bumped
      // port, and it publishes state.json as soon as it is listening
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

async function fetchModels(): Promise<ModelItem[]> {
  try {
    const res = await fetch(modelsUrl(), { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: ModelItem[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

export default async function (pi: ExtensionAPI) {
  const daemonReady = await ensureDaemonRunning();

  let models: ModelItem[] = [];
  if (daemonReady) {
    models = await fetchModels();
  }

  if (models.length === 0) {
    models = [
      { id: "mimo-v2.5-free", name: "Mimo V2.5 Free (Zen)", context_window: 200000, max_tokens: 32000, reasoning: true },
      { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra (Zen)", context_window: 1000000, max_tokens: 128000, reasoning: true },
      { id: "big-pickle", name: "Big Pickle (Zen)", context_window: 200000, max_tokens: 32000, reasoning: true },
      { id: "laguna-s-2.1-free", name: "Laguna S 2.1 (Zen)", context_window: 256000, max_tokens: 32000, reasoning: true },
      { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free (Zen)", context_window: 262144, max_tokens: 262144, reasoning: true },
      { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free (Zen)", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "kilo-auto/free", name: "Kilo Auto Free (Kilo)", context_window: 256000, max_tokens: 10000, reasoning: true },
      { id: "stepfun/step-3.7-flash:free", name: "Step 3.7 Flash Free (Kilo)", context_window: 262144, max_tokens: 262144, reasoning: true },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra (Kilo)", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super (Kilo)", context_window: 262144, max_tokens: 262144, reasoning: true },
      { id: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning (Kilo)", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "nvidia/nemotron-3.5-content-safety:free", name: "Nemotron 3.5 Content Safety (Kilo)", context_window: 128000, max_tokens: 8192, reasoning: true },
      { id: "liquid/lfm-2.5-2.6b:free", name: "Liquid LFM 2.5 2.6B (Kilo)", context_window: 65536, max_tokens: 8192, reasoning: true },
      { id: "poolside/laguna-s-2.1:free", name: "Laguna S 2.1 (Kilo)", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "cohere/north-mini-code:free", name: "North Mini Code (Kilo)", context_window: 256000, max_tokens: 64000, reasoning: true },
      { id: "poolside/laguna-xs-2.1:free", name: "Laguna XS 2.1 (Kilo)", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "Nemotron 3 Nano Omni (Kilo)", context_window: 256000, max_tokens: 65536, reasoning: true },
      { id: "minimax/minimax-m3:free", name: "MiniMax M3 (Kilo)", context_window: 1048576, max_tokens: 65536, reasoning: true },
      { id: "minimax/minimax-m2.7:free", name: "MiniMax M2.7 (Kilo)", context_window: 196608, max_tokens: 65536, reasoning: true },
      { id: "inclusionai/ling-3.0-flash-fin:free", name: "Ling 3.0 Flash Fin (Kilo)", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "dots-studio/dots-3-note-preview:free", name: "Dots 3 Note Preview (Kilo)", context_window: 512000, max_tokens: 65536, reasoning: true },
      { id: "thinkingmachines/inkling:free", name: "Inkling (Kilo)", context_window: 1048576, max_tokens: 65536, reasoning: true },
      { id: "thinkingmachines/inkling-small:free", name: "Inkling Small (Kilo)", context_window: 1048576, max_tokens: 65536, reasoning: true },
      { id: "openrouter/free", name: "OpenRouter Free (Kilo)", context_window: 200000, max_tokens: 65536, reasoning: true },
      { id: "codestral-latest", name: "Codestral Latest (LLM7)", context_window: 32000, max_tokens: 8192, reasoning: false },
      { id: "gpt-oss", name: "GPT OSS 20B (LLM7)", context_window: 131072, max_tokens: 16384, reasoning: true },
      { id: "minimax-m2.7", name: "MiniMax M2.7 (LLM7)", context_window: 180000, max_tokens: 32768, reasoning: true },
      { id: "mistral-Nemo-Instruct-2407", name: "Mistral Nemo Instruct (LLM7)", context_window: 128000, max_tokens: 16384, reasoning: false },
      { id: "default", name: "LLM7 Default", context_window: 128000, max_tokens: 8000, reasoning: false },
      { id: "fast", name: "LLM7 Fast", context_window: 128000, max_tokens: 8000, reasoning: false },
    ];
  }

  // pi resolves the provider baseUrl once, so remember what we handed it: a
  // daemon that later moves ports leaves the provider pointing at nothing
  const registeredEndpoint = endpoint;

  // register the bansosr provider in pi
  pi.registerProvider("bansosr", {
    baseUrl: baseUrl(registeredEndpoint),
    apiKey: "bansos",
    api: "openai-completions",
    models: models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      reasoning: m.reasoning ?? (m.id.includes("deepseek") || m.id.includes("ultra") || m.id.includes("pickle") || m.id.includes("super") || m.id.includes("lightning") || m.id.includes("nano")),
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.context_window ?? 256000,
      maxTokens: m.max_tokens ?? 32000,
    })),
  });

  // register /bansosr command
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
      const liveModels = await fetchModels();
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
    // signal that one pid directly: `bansos stop` scans every process on the
    // machine and would take daemons this extension never started with it.
    // Re-check state.json first so a pid recycled by an unrelated process, or a
    // daemon someone else restarted in the meantime, is left alone.
    if (readDaemonState()?.pid !== spawnedDaemonPid) return;
    try {
      process.kill(spawnedDaemonPid, "SIGTERM");
    } catch {
      // already gone
    }
  });
}
