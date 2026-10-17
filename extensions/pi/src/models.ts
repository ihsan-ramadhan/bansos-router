import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ModelItem {
  id: string;
  name?: string;
  source?: string;
  context_window?: number;
  max_tokens?: number;
  reasoning?: boolean;
  input?: string[];
}

export const MODELS_CACHE_FILE = path.join(os.homedir(), ".bansos", "pi-models.json");
export const FETCH_TIMEOUT_MS = 5000;

// last resort when the daemon is unreachable and no catalog was ever cached
export const FALLBACK_MODELS: ModelItem[] = [
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

export function chooseModels(live: ModelItem[], cached: ModelItem[]): ModelItem[] {
  if (live.length > 0) return live;
  if (cached.length > 0) return cached;
  return FALLBACK_MODELS;
}
