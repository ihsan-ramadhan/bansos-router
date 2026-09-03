

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
  input: Array<"text" | "image">;
  compat: ModelCompatibility;
  cost: ModelCost;
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

export function pickSmartDefaultModel(models: ModelDef[], fallback = "mimo-v2.5-free"): string {
  const valid = models.filter((m) => !m.id.toLowerCase().includes("safety"));
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
  // live model catalog, or null when unreachable
  fetchCatalog(): Promise<ModelDef[] | null>;
  // extra headers for upstream requests (spoofed cli identity)
  requestHeaders(model: ModelDef): Record<string, string>;
}
