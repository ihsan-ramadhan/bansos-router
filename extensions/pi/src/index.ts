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
const EXTENSION_VERSION = "0.3.3";

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
  source?: string;
  context_window?: number;
  max_tokens?: number;
  reasoning?: boolean;
  input?: string[];
}

const MODELS_CACHE_FILE = path.join(os.homedir(), ".bansos", "pi-models.json");
const FETCH_TIMEOUT_MS = 5000;

// last resort when the daemon is unreachable and no catalog was ever cached
const FALLBACK_MODELS: ModelItem[] = [
      { id: "longcat-2.5-preview-free", name: "LongCat 2.5 Preview Free", source: "zen", context_window: 1000000, max_tokens: 131072, reasoning: true, input: ["text", "image"] },
      { id: "space-bunny-free", name: "Space Bunny Free", source: "zen", context_window: 1048576, max_tokens: 524288, reasoning: true, input: ["text", "image"] },
      { id: "mimo-v2.6-flash-free", name: "MiMo-V2.6-Flash Free", source: "zen", context_window: 200000, max_tokens: 32000, reasoning: true, input: ["text", "image"] },
      { id: "glm-5.3-flash-free", name: "GLM-5.3-Flash Free", source: "zen", context_window: 200000, max_tokens: 32000, reasoning: true, input: ["text", "image"] },
      { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", source: "zen", context_window: 262144, max_tokens: 262144, reasoning: true },
      { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL Free", source: "zen", context_window: 1048576, max_tokens: 131072, reasoning: true, input: ["text", "image"] },
      { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free", source: "zen", context_window: 200000, max_tokens: 32000, reasoning: true, input: ["text", "image"] },
      { id: "beam-free", name: "Beam Free", source: "zen", context_window: 1048576, max_tokens: 131072, reasoning: true },
      { id: "big-pickle", name: "Big Pickle", source: "zen", context_window: 200000, max_tokens: 32000, reasoning: true },
      { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Free", source: "zen", context_window: 1048576, max_tokens: 131072, reasoning: true, input: ["text", "image"] },
      { id: "cat-jam-free", name: "Cat Jam Free", source: "zen", context_window: 262144, max_tokens: 131072, reasoning: true },
      { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", source: "zen", context_window: 1000000, max_tokens: 128000, reasoning: true },
      { id: "kilo-auto/free", name: "Kilo Auto Free", source: "kilo", context_window: 256000, max_tokens: 10000, reasoning: true },
      { id: "nvidia/nemotron-3.5-super-vl:free", name: "NVIDIA: Nemotron 3.5 Super VL (free)", source: "kilo", context_window: 1000000, max_tokens: 10000, reasoning: true, input: ["text", "image"] },
      { id: "xingchen-agi/xing4.0-29b-a4b:free", name: "XingChen: Xing4.0 29B A4B (free)", source: "kilo", context_window: 262144, max_tokens: 10000, reasoning: true },
      { id: "dots-studio/dots-3-note-preview:free", name: "Dots 3 Note Preview Free", source: "kilo", context_window: 512000, max_tokens: 65536, reasoning: true, input: ["text", "image"] },
      { id: "liquid/lfm-2.5-2.6b:free", name: "Liquid LFM 2.5 2.6B Free", source: "kilo", context_window: 65536, max_tokens: 8192, reasoning: true },
      { id: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning Free", source: "kilo", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "thinkingmachines/inkling-small:free", name: "Thinking Machines Inkling Small Free", source: "kilo", context_window: 1048576, max_tokens: 65536, reasoning: true, input: ["text", "image"] },
      { id: "poolside/laguna-s-2.1:free", name: "Laguna S 2.1 Free", source: "kilo", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "poolside/laguna-xs-2.1:free", name: "Laguna XS 2.1 Free", source: "kilo", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "cohere/north-mini-code:free", name: "North Mini Code Free", source: "kilo", context_window: 256000, max_tokens: 64000, reasoning: true },
      { id: "nvidia/nemotron-3.5-content-safety:free", name: "Nemotron 3.5 Content Safety Free", source: "kilo", context_window: 128000, max_tokens: 8192, reasoning: true, input: ["text", "image"] },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra Free", source: "kilo", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "Nemotron 3 Nano Omni Free", source: "kilo", context_window: 256000, max_tokens: 65536, reasoning: true, input: ["text", "image"] },
      { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super Free", source: "kilo", context_window: 262144, max_tokens: 262144, reasoning: true },
      { id: "openrouter/free", name: "OpenRouter Free", source: "kilo", context_window: 200000, max_tokens: 65536, reasoning: true, input: ["text", "image"] },
      { id: "DeepSeek-V4-Flash-0731", name: "DeepSeek-V4-Flash-0731", source: "llm7", context_window: 400000, max_tokens: 16384, reasoning: true },
      { id: "GLM-5.3-Flash", name: "GLM-5.3-Flash", source: "llm7", context_window: 400000, max_tokens: 16384, reasoning: true },
      { id: "codestral-latest", name: "Codestral Latest", source: "llm7", context_window: 32000, max_tokens: 8192, reasoning: false },
      { id: "gpt-oss:20b", name: "gpt-oss:20b", source: "llm7", context_window: 128000, max_tokens: 16384, reasoning: false },
      { id: "minimax-m2.7", name: "MiniMax M2.7", source: "llm7", context_window: 180000, max_tokens: 32768, reasoning: true },
      { id: "mistral-Nemo-Instruct-2407", name: "Mistral Nemo Instruct", source: "llm7", context_window: 128000, max_tokens: 16384, reasoning: false },
      { id: "nemotron-3-nano:30b", name: "nemotron-3-nano:30b", source: "llm7", context_window: 1000000, max_tokens: 16384, reasoning: true },
      { id: "default", name: "LLM7 Default", source: "llm7", context_window: 128000, max_tokens: 8192, reasoning: false },
      { id: "fast", name: "LLM7 Fast", source: "llm7", context_window: 128000, max_tokens: 8192, reasoning: false },
      { id: "ovh/gpt-oss-120b", name: "GPT-OSS 120B (OVH)", source: "ovh", context_window: 131072, max_tokens: 32768, reasoning: true },
      { id: "ovh/gpt-oss-20b", name: "GPT-OSS 20B (OVH)", source: "ovh", context_window: 131072, max_tokens: 32768, reasoning: true },
      { id: "ovh/Qwen3.5-397B-A17B", name: "Qwen3.5 397B A17B (OVH)", source: "ovh", context_window: 262144, max_tokens: 65536, reasoning: true, input: ["text", "image"] },
      { id: "ovh/Qwen3.8-27B", name: "Qwen3.8 27B (OVH)", source: "ovh", context_window: 262144, max_tokens: 32768, reasoning: true, input: ["text", "image"] },
      { id: "ovh/Qwen3.6-27B", name: "Qwen3.6 27B (OVH)", source: "ovh", context_window: 262144, max_tokens: 65536, reasoning: true, input: ["text", "image"] },
      { id: "ovh/Qwen3.5-9B", name: "Qwen3.5 9B (OVH)", source: "ovh", context_window: 262144, max_tokens: 65536, reasoning: true, input: ["text", "image"] },
      { id: "ovh/Mistral-Small-3.2-24B-Instruct-2506", name: "Mistral Small 3.2 24B (OVH)", source: "ovh", context_window: 131072, max_tokens: 16384, reasoning: false, input: ["text", "image"] },
      { id: "ovh/Meta-Llama-3_3-70B-Instruct", name: "Llama 3.3 70B (OVH)", source: "ovh", context_window: 131072, max_tokens: 16384, reasoning: false },
];

export function readCachedModels(file = MODELS_CACHE_FILE): ModelItem[] {
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as { models?: ModelItem[] };
    return Array.isArray(cached.models) ? cached.models.filter((m) => typeof m?.id === "string") : [];
  } catch {
    return [];
  }
}

export function writeCachedModels(models: ModelItem[], file = MODELS_CACHE_FILE): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ savedAt: new Date().toISOString(), models })}\n`);
  } catch {
    // a read-only home only costs the cache
  }
}

export function toProviderModel(m: ModelItem) {
  return {
    id: m.id,
    name: displayName(m),
    reasoning: m.reasoning ?? false,
    input: (m.input?.includes("image") ? ["text", "image"] : ["text"]) as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.context_window ?? 256000,
    maxTokens: m.max_tokens ?? 32000,
  };
}

const SOURCE_LABELS: Record<string, string> = { zen: "Zen", kilo: "Kilo", llm7: "LLM7", ovh: "OVH", local: "Local" };

export function displayName(m: ModelItem): string {
  const base = m.name ?? m.id;
  if (!m.source) return base;
  const label = SOURCE_LABELS[m.source] ?? m.source;
  return base.toLowerCase().includes(label.toLowerCase()) ? base : `${base} (${label})`;
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

export function chooseModels(live: ModelItem[], cached: ModelItem[]): ModelItem[] {
  if (live.length > 0) return live;
  if (cached.length > 0) return cached;
  return FALLBACK_MODELS;
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
