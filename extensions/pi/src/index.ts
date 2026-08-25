import { spawn } from "node:child_process";
import http from "node:http";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_PORT = 17070;
const BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}/v1`;
const HEALTHZ_URL = `http://127.0.0.1:${DEFAULT_PORT}/healthz`;
const MODELS_URL = `http://127.0.0.1:${DEFAULT_PORT}/v1/models`;
const EXTENSION_VERSION = "0.2.1";

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

let spawnedByExtension = false;

async function isDaemonAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTHZ_URL, { timeout: 1000 }, (res) => {
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
  if (await isDaemonAlive()) {
    return true;
  }

  try {
    const child = spawn("bansos", ["start", "--bg"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    spawnedByExtension = true;

    const start = Date.now();
    while (Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 200));
      if (await isDaemonAlive()) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function fetchModels(): Promise<ModelItem[]> {
  try {
    const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(2000) });
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
      { id: "x-preview-f-free", name: "Ox Alpha Free (Zen)", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "hy3-free", name: "Tencent HY3 Free (Zen)", context_window: 256000, max_tokens: 65536, reasoning: true },
      { id: "mimo-v2.5-free", name: "Mimo V2.5 Free (Zen)", context_window: 1048576, max_tokens: 131072, reasoning: false },
      { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra (Zen)", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "big-pickle", name: "Big Pickle (Zen)", context_window: 200000, max_tokens: 32000, reasoning: true },
      { id: "laguna-s-2.1-free", name: "Laguna S 2.1 (Zen)", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free (Zen)", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free (Zen)", context_window: 1000000, max_tokens: 65536, reasoning: false },
      { id: "kilo-auto/free", name: "Kilo Auto Free (Kilo)", context_window: 256000, max_tokens: 10000, reasoning: false },
      { id: "stepfun/step-3.7-flash:free", name: "Step 3.7 Flash Free (Kilo)", context_window: 262144, max_tokens: 262144, reasoning: false },
      { id: "tencent/hy3:free", name: "Tencent HY3 Free (Kilo)", context_window: 262144, max_tokens: 128000, reasoning: true },
      { id: "DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash (LLM7)", context_window: 400000, max_tokens: 131072, reasoning: true },
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (LLM7)", context_window: 256000, max_tokens: 65536, reasoning: false },
      { id: "default", name: "LLM7 Default", context_window: 128000, max_tokens: 8000, reasoning: false },
      { id: "fast", name: "LLM7 Fast", context_window: 128000, max_tokens: 8000, reasoning: false },
    ];
  }

  // register the bansosr provider in pi
  pi.registerProvider("bansosr", {
    baseUrl: BASE_URL,
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
      const alive = await isDaemonAlive();
      if (!alive) {
        ctx.ui.notify("bansos daemon is NOT running. Try: bansos start", "error");
        return;
      }
      const liveModels = await fetchModels();
      let relayInfo = "";
      try {
        const res = await fetch(HEALTHZ_URL, { signal: AbortSignal.timeout(1000) });
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
    if (spawnedByExtension && event.reason === "quit") {
      try {
        spawn("bansos", ["stop"], { stdio: "ignore", detached: true }).unref();
      } catch {
        // ignore
      }
    }
  });
}
