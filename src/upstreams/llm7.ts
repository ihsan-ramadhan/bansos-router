import { modelDef, type ModelDef, type Upstream } from "./types";

export const LLM7_BASE_URL = "https://api.llm7.io/v1";
export const LLM7_ANONYMOUS_KEY = "unused";

export const LLM7_ALIASES = ["default", "fast"] as const;

export const LLM7_MODELS: ModelDef[] = [
  modelDef({
    id: "DeepSeek-V4-Flash-0731",
    name: "DeepSeek V4 Flash",
    source: "llm7",
    reasoning: true,
    contextWindow: 400_000,
    maxTokens: 131_072,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "codestral-latest",
    name: "Codestral Latest",
    source: "llm7",
    reasoning: false,
    contextWindow: 32_000,
    maxTokens: 8_192,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    source: "llm7",
    reasoning: false,
    contextWindow: 256_000,
    maxTokens: 65_536,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "gpt-oss:20b",
    name: "GPT OSS 20B",
    source: "llm7",
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 16_384,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    source: "llm7",
    reasoning: true,
    contextWindow: 180_000,
    maxTokens: 32_768,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "mistral-Nemo-Instruct-2407",
    name: "Mistral Nemo Instruct",
    source: "llm7",
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 16_384,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "default",
    name: "LLM7 Default",
    source: "llm7",
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "fast",
    name: "LLM7 Fast",
    source: "llm7",
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
];

interface LLM7ApiModel {
  id: string;
  usage_based_only?: boolean;
  tier?: string;
  reasoning?: boolean;
  context_window?: { tokens?: number };
  modalities?: { input?: string[] };
}

export const llm7Upstream: Upstream = {
  id: "llm7",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `${LLM7_BASE_URL}/chat/completions`,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    try {
      const res = await fetch(`${LLM7_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${LLM7_ANONYMOUS_KEY}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { data?: LLM7ApiModel[] };
      if (!Array.isArray(body.data) || body.data.length === 0) return null;

      // filter models accessible anonymously without per-token charge
      const freeModels = body.data.filter(
        (m) => m.usage_based_only === false || (m.tier === "turbo" && m.usage_based_only !== true),
      );

      const dynamic = freeModels.map((m) => {
        const seeded = LLM7_MODELS.find((s) => s.id === m.id);
        const context = m.context_window?.tokens ?? seeded?.contextWindow ?? 128_000;
        const input: ("text" | "image")[] = Array.isArray(m.modalities?.input) && m.modalities?.input.includes("image")
          ? ["text", "image"]
          : ["text"];

        return modelDef({
          id: m.id,
          name: seeded?.name ?? m.id,
          source: "llm7",
          reasoning: m.reasoning ?? seeded?.reasoning ?? false,
          contextWindow: context,
          maxTokens: seeded?.maxTokens ?? 16_384,
          input,
          compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
        });
      });

      for (const alias of ["default", "fast"]) {
        if (!dynamic.some((m) => m.id === alias)) {
          const aliasDef = LLM7_MODELS.find((m) => m.id === alias);
          if (aliasDef) dynamic.push(aliasDef);
        }
      }

      return dynamic;
    } catch {
      return null;
    }
  },

  requestHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${LLM7_ANONYMOUS_KEY}` };
  },
};
