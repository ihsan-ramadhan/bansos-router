import { modelDef, type ModelDef, type Upstream } from "./types";

export const KILO_CHAT_URL = "https://api.kilo.ai/api/gateway/chat/completions";
export const KILO_CATALOG_URL = "https://api.kilo.ai/api/gateway/models";

// pinned kilo free models verified against the live gateway catalog
export const KILO_MODELS: ModelDef[] = [
  modelDef({
    id: "baidu/ernie-5.5-flash-preview:free",
    name: "Baidu: ERNIE-5.5-Flash-Preview (free)",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_024_000,
    maxTokens: 10_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "inclusionai/ling-3.2-flash:free",
    name: "inclusionAI: Ling 3.2 Flash (free)",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 10_000,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "liquid/lfm-3-1.7b:free",
    name: "LiquidAI: LFM3-1.7B (free)",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 10_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "particle-ai/particle-1:free",
    name: "Particle AI: Particle-1 (free)",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 10_000,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "recursive/flint-v1.0:free",
    name: "Recursive: Flint (free)",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 10_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "kilo-auto/free",
    name: "Kilo Auto Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 256_000,
    maxTokens: 10_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nvidia/nemotron-3.5-super-vl:free",
    name: "NVIDIA: Nemotron 3.5 Super VL (free)",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 10_000,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nvidia/nemotron-3.5-lightning:free",
    name: "Nemotron 3.5 Lightning Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    name: "Nemotron 3 Nano Omni Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 256_000,
    maxTokens: 65_536,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "openrouter/free",
    name: "OpenRouter Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 65_536,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
];

interface KiloApiModel {
  id: string;
  name?: string;
  context_length?: number;
  isFree?: boolean;
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

export const kiloUpstream: Upstream = {
  id: "kilo",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: KILO_CHAT_URL,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    try {
      const res = await fetch(KILO_CATALOG_URL, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: KiloApiModel[] };
      const live = json.data ?? [];
      const free = live.filter(
        (m) => m.id.endsWith(":free") || KILO_MODELS.some((k) => k.id === m.id),
      );
      if (free.length === 0) return null;
      return free.map((m) => {
        const known = KILO_MODELS.find((k) => k.id === m.id);
        const modalities = m.architecture?.input_modalities ?? [];
        const input: ("text" | "image")[] = modalities.includes("image")
          ? ["text", "image"]
          : ["text"];
        const tools = m.supported_parameters ? { supportsTools: m.supported_parameters.includes("tools") } : {};
        if (known) {
          return modelDef({
            ...known,
            contextWindow: m.context_length ?? known.contextWindow,
            reasoning: m.supported_parameters?.includes("reasoning") ?? known.reasoning,
            input,
            ...tools,
          });
        }
        return modelDef({
          id: m.id,
          name: m.name ? m.name : m.id,
          source: "kilo",
          reasoning: m.supported_parameters?.includes("reasoning") ?? false,
          contextWindow: m.context_length ?? 200_000,
          maxTokens: 10_000,
          input,
          compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
          ...tools,
        });
      });
    } catch {
      return null;
    }
  },

  requestHeaders(): Record<string, string> {
    return {};
  },
};
