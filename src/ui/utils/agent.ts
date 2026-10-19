import type { ModelItem, ModelMode, ModelPick } from "../types";
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
    case "ovh":
      return "bg-amber-400";
    default:
      return "bg-zinc-400";
  }
}

export function getHarnessStrategy(mode: ModelMode, modelCount: number) {
  switch (mode) {
    case "tiered":
      return {
        label: `Haiku, Sonnet and Opus from ${modelCount} model${modelCount === 1 ? "" : "s"}`,
        description: "Maps Haiku to a fast model and Sonnet and Opus to reasoning models",
        color: "text-amber-300 bg-amber-950/60 border-amber-800/40",
      };
    case "list":
      return {
        label: `${modelCount} model${modelCount === 1 ? "" : "s"} registered`,
        description: `Registers ${modelCount} free models in the agent config`,
        color: "text-emerald-300 bg-emerald-950/60 border-emerald-800/40",
      };
    case "discovery":
      return {
        label: "Discovers models from /v1/models",
        description: "The agent lists the live models from bansos itself",
        color: "text-cyan-300 bg-cyan-950/60 border-cyan-800/40",
      };
    default:
      return {
        label: "Catalog default model",
        description: "Sets the catalog's default reasoning model",
        color: "text-blue-300 bg-blue-950/60 border-blue-800/40",
      };
  }
}

const providerOf = (m: ModelItem) => (m.source || m.owned_by || "other").toLowerCase();

// what a pick covers in today's catalog: every model of a picked upstream, new ones included, plus single ids
export function pickedModels(models: ModelItem[], pick: ModelPick): ModelItem[] {
  return models.filter((m) => pick.upstreams?.includes(providerOf(m)) || pick.models?.includes(m.id));
}

// a fully checked provider becomes an --upstream pick, the rest stay individual ids
export function pickFromChecked(models: ModelItem[], checked: string[]): ModelPick {
  const set = new Set(checked);
  const upstreams: string[] = [];
  const ids: string[] = [];
  for (const group of groupModelsByProvider(models)) {
    const picked = group.models.filter((m) => set.has(m.id)).map((m) => m.id);
    if (picked.length > 0 && picked.length === group.models.length) upstreams.push(group.provider);
    else ids.push(...picked);
  }
  return { ...(upstreams.length > 0 ? { upstreams } : {}), ...(ids.length > 0 ? { models: ids } : {}) };
}

export function setupCommand(adapterId: string, pick: ModelPick): string {
  const parts = [`bansos setup ${adapterId}`];
  if (pick.model) parts.push(`--model ${pick.model}`);
  if (pick.upstreams?.length) parts.push(`--upstream ${pick.upstreams.join(",")}`);
  if (pick.models?.length) parts.push(`--models ${pick.models.join(",")}`);
  return parts.join(" ");
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
  const order = ["zen", "kilo", "llm7", "ovh", "local"];
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
