

export type UpstreamSource = "zen" | "kilo" | "llm7" | "local";
export type UpstreamKind = "remote-keyless" | "local-openai";

// per-model translation flags
export interface ModelCompatibility {
  supportsReasoningEffort: boolean;
  supportsDeveloperRole: boolean;
  // upstreams that emit reasoning instead of content
  thinkingFormat?: "content" | "reasoning-field";
}

export interface ModelCost {
  input: 0;
  output: 0;
  cacheRead: 0;
  cacheWrite: 0;
}

export interface ModelDef {
  // exact upstream model id (never an alias)
  id: string;
  name: string;
  source: UpstreamSource;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: Array<"text" | "image" | "audio" | "video" | "pdf">;
  compat: ModelCompatibility;
  cost: ModelCost;
  // defaults to chat completions. "responses" models (zen's muse spark) return
  // 500 on /chat/completions and get translated on the upstream leg instead.
  wireApi?: "chat" | "responses";
}

export const ZERO_COST: ModelCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function modelDef(partial: Omit<ModelDef, "cost"> & { cost?: ModelCost }): ModelDef {
  return { cost: ZERO_COST, ...partial };
}

export function compareModelsByCapacity(a: ModelDef, b: ModelDef): number {
  if (b.contextWindow !== a.contextWindow) return b.contextWindow - a.contextWindow;
  return b.maxTokens - a.maxTokens;
}

// muse spark 1.3 has a smaller nominal context than inkling but is the better
// coding default, which capacity ranking alone cannot express. this shortlist
// wins whenever the model is alive.
export const PREFERRED_DEFAULT_MODELS = ["muse-spark-1.3-contributor-free"];

export function pickSmartDefaultModel(models: ModelDef[], fallback = "mimo-v2.5-free"): string {
  const valid = models.filter((m) => !m.id.toLowerCase().includes("safety"));
  for (const id of PREFERRED_DEFAULT_MODELS) {
    if (valid.some((m) => m.id === id)) return id;
  }
  const reasoning = valid.filter((m) => m.reasoning).sort(compareModelsByCapacity);
  if (reasoning.length > 0) return reasoning[0]!.id;

  const nonReasoning = [...valid].sort(compareModelsByCapacity);
  if (nonReasoning.length > 0) return nonReasoning[0]!.id;

  return fallback;
}

// null means unreachable; keep last-known models
export interface Upstream {
  id: string;
  kind: UpstreamKind;
  // remote keyless sources may use a user-owned relay
  relayAllowed: boolean;
  // full chat endpoint, e.g. "https://opencode.ai/zen/v1/chat/completions"
  chatUrl: string;
  // full responses endpoint, required only when the upstream seeds models with
  // wireApi: "responses"
  responsesUrl?: string;
  // live model catalog, or null when unreachable
  fetchCatalog(): Promise<ModelDef[] | null>;
  // extra headers for upstream requests (spoofed cli identity)
  requestHeaders(model?: ModelDef): Record<string, string>;
  // optionally adapt body for upstream quirks (e.g. gateway spoofing)
  transformRequestBody?(body: Record<string, unknown>, model: ModelDef): Record<string, unknown>;
}
