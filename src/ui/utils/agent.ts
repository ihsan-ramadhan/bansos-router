import type { ModelItem } from "../types";
import { formatProviderLabel } from "./models";

export function getWireLabel(wire: string): string {
  if (wire === "anthropic") return "Anthropic";
  if (wire === "responses") return "Responses";
  return "Chat";
}

export function getWireBadge(wire?: string) {
  switch (wire) {
    case "anthropic":
      return { label: "Anthropic Messages API", color: "text-amber-300 bg-amber-950/60 border-amber-800/40" };
    case "responses":
      return { label: "OpenAI Responses API", color: "text-purple-300 bg-purple-950/60 border-purple-800/40" };
    default:
      return { label: "OpenAI Chat Completions API", color: "text-blue-300 bg-blue-950/60 border-blue-800/40" };
  }
}

export function getProviderDotColor(provider: string): string {
  switch (provider.toLowerCase()) {
    case "zen":
      return "bg-blue-400";
    case "kilo":
      return "bg-purple-400";
    case "llm7":
      return "bg-emerald-400";
    default:
      return "bg-zinc-400";
  }
}

export function getHarnessStrategy(adapterId: string, modelCount: number) {
  switch (adapterId) {
    case "claude-code":
      return {
        type: "tiered",
        label: "Smart Tier (Haiku: Fast / Sonnet & Opus: Reasoning)",
        description: "Auto-maps Haiku (fast non-reasoning) & Sonnet/Opus (flagship reasoning)",
        color: "text-amber-300 bg-amber-950/60 border-amber-800/40",
      };
    case "opencode":
    case "goose":
    case "openclaw":
    case "continue":
      return {
        type: "multi",
        label: `All Models (${modelCount} Models Registered)`,
        description: `Registers all ${modelCount} free models directly into agent config`,
        color: "text-emerald-300 bg-emerald-950/60 border-emerald-800/40",
      };
    case "9router":
    case "jcode":
      return {
        type: "dynamic",
        label: "Dynamic Model Discovery",
        description: "Fetches live models dynamically from /v1/models at runtime",
        color: "text-cyan-300 bg-cyan-950/60 border-cyan-800/40",
      };
    default:
      return {
        type: "single",
        label: "Single Active Model",
        description: "Sets primary flagship model in agent config",
        color: "text-blue-300 bg-blue-950/60 border-blue-800/40",
      };
  }
}

export interface GroupedModel {
  provider: string;
  label: string;
  models: ModelItem[];
}

export function groupModelsByProvider(models: ModelItem[]): GroupedModel[] {
  const groups: Record<string, ModelItem[]> = {};
  for (const m of models) {
    const p = (m.source || m.owned_by || "other").toLowerCase();
    groups[p] ??= [];
    groups[p].push(m);
  }
  const order = ["zen", "kilo", "llm7", "local"];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const idxA = order.indexOf(a);
    const idxB = order.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
  return sortedKeys.map((k) => ({
    provider: k,
    label: formatProviderLabel(k),
    models: groups[k] ?? [],
  }));
}
