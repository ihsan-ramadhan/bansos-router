import { modelDef, type ModelDef, type Upstream } from "./types";

export const KILO_CHAT_URL = "https://api.kilo.ai/api/gateway/chat/completions";
export const KILO_CATALOG_URL = "https://api.kilo.ai/api/gateway/models";

// pinned free models (carried over from pi-bansos)
export const KILO_MODELS: ModelDef[] = [
  modelDef({
    id: "kilo-auto/free",
    name: "Kilo Auto Free",
    source: "kilo",
    reasoning: false,
    contextWindow: 256_000,
    maxTokens: 10_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "stepfun/step-3.7-flash:free",
    name: "Step 3.7 Flash Free",
    source: "kilo",
    reasoning: false,
    contextWindow: 262_144,
    maxTokens: 262_144,
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
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron 3 Super Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 262_144,
    input: ["text"],
    compat: {
      supportsReasoningEffort: false,
      supportsDeveloperRole: false,
      thinkingFormat: "reasoning-field",
    },
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
    id: "nvidia/nemotron-3.5-content-safety:free",
    name: "Nemotron 3.5 Content Safety Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 128_000,
    maxTokens: 8_192,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "tencent/hy3:free",
    name: "Tencent HY3 Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 128_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "liquid/lfm-2.5-2.6b:free",
    name: "Liquid LFM 2.5 2.6B Free",
    source: "kilo",
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "poolside/laguna-s-2.1:free",
    name: "Laguna S 2.1 Free",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "cohere/north-mini-code:free",
    name: "North Mini Code Free",
    source: "kilo",
    reasoning: false,
    contextWindow: 256_000,
    maxTokens: 64_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "poolside/laguna-xs-2.1:free",
    name: "Laguna XS 2.1 Free",
    source: "kilo",
    reasoning: false,
    contextWindow: 262_144,
    maxTokens: 32_768,
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
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "openrouter/free",
    name: "OpenRouter Free",
    source: "kilo",
    reasoning: false,
    contextWindow: 200_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
];

export const kiloUpstream: Upstream = {
  id: "kilo",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: KILO_CHAT_URL,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    try {
      const res = await fetch(KILO_CATALOG_URL);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: Array<{ id: string; name?: string; context_length?: number }>;
      };
      const live = json.data ?? [];
      const free = live.filter(
        (m) => m.id.endsWith(":free") || KILO_MODELS.some((k) => k.id === m.id),
      );
      if (free.length === 0) return null;
      return free.map((m) => {
        const known = KILO_MODELS.find((k) => k.id === m.id);
        if (known) return known;
        return modelDef({
          id: m.id,
          name: m.name ? m.name : m.id,
          source: "kilo",
          reasoning: false,
          contextWindow: m.context_length ?? 200_000,
          maxTokens: 10_000,
          input: ["text"],
          compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
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
