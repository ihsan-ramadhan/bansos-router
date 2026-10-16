import { modelDef, type ModelDef, type Upstream } from "./types";

export const OVH_BASE_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1";
export const OVH_PREFIX = "ovh/";

function ovhModel(
  id: string,
  name: string,
  reasoning: boolean,
  contextWindow: number,
  maxTokens: number,
  vision: boolean,
): ModelDef {
  return modelDef({
    id: `${OVH_PREFIX}${id}`,
    name: `${name} (OVH)`,
    source: "ovh",
    reasoning,
    contextWindow,
    maxTokens,
    input: vision ? ["text", "image"] : ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  });
}

export const OVH_MODELS: ModelDef[] = [
  ovhModel("gpt-oss-120b", "GPT-OSS 120B", true, 131_072, 32_768, false),
  ovhModel("gpt-oss-20b", "GPT-OSS 20B", true, 131_072, 32_768, false),
  ovhModel("Qwen3.5-397B-A17B", "Qwen3.5 397B A17B", true, 262_144, 65_536, true),
  ovhModel("Qwen3.8-27B", "Qwen3.8 27B", true, 262_144, 32_768, true),
  ovhModel("Qwen3.6-27B", "Qwen3.6 27B", true, 262_144, 65_536, true),
  ovhModel("Qwen3.5-9B", "Qwen3.5 9B", true, 262_144, 65_536, true),
  ovhModel("Mistral-Small-3.2-24B-Instruct-2506", "Mistral Small 3.2 24B", false, 131_072, 16_384, true),
  ovhModel("Meta-Llama-3_3-70B-Instruct", "Llama 3.3 70B", false, 131_072, 16_384, false),
];

interface OvhApiModel {
  id: string;
  context_length?: number;
}

export const ovhUpstream: Upstream = {
  id: "ovh",
  kind: "remote-keyless",
  relayAllowed: false,
  chatUrl: `${OVH_BASE_URL}/chat/completions`,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    try {
      const res = await fetch(`${OVH_BASE_URL}/models`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: OvhApiModel[] };
      if (!Array.isArray(body.data)) return null;
      const live = new Map(body.data.map((m) => [`${OVH_PREFIX}${m.id}`, m]));
      return OVH_MODELS.filter((m) => live.has(m.id)).map((m) => ({
        ...m,
        contextWindow: live.get(m.id)!.context_length || m.contextWindow,
      }));
    } catch {
      return null;
    }
  },

  requestHeaders(): Record<string, string> {
    return {};
  },

  transformRequestBody(body: Record<string, unknown>, model: ModelDef): Record<string, unknown> {
    return { ...body, model: model.id.slice(OVH_PREFIX.length) };
  },
};
