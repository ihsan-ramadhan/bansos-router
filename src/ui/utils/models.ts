import type { ModelItem, PingResult, FilterAndSortOptions } from "../types";

export type CapabilityFilter = "all" | "reasoning" | "fast" | "megacontext" | "vision";
export type HealthFilter = "all" | "ok" | "429" | "error";
export type ModelSortField = "default" | "model" | "reasoning" | "context" | "maxOutput" | "latency";

export function formatTokens(tokens?: number): string {
  if (!tokens) return "-";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export function formatProviderLabel(provider: string): string {
  switch (provider.toLowerCase()) {
    case "zen":
      return "OpenCode Zen";
    case "kilo":
      return "KiloCode";
    case "llm7":
      return "LLM7";
    case "local":
      return "Local / OpenAI";
    default:
      return provider.toUpperCase();
  }
}

export function getProviderBadgeColor(provider: string): string {
  switch (provider.toLowerCase()) {
    case "opencode":
    case "zen":
      return "bg-blue-950/70 text-blue-300 border-blue-800/60";
    case "kilo":
    case "kilocode":
      return "bg-purple-950/70 text-purple-300 border-purple-800/60";
    case "llm7":
      return "bg-emerald-950/70 text-emerald-300 border-emerald-800/60";
    default:
      return "bg-zinc-800/70 text-zinc-300 border-zinc-700/60";
  }
}

export function matchesSearch(m: ModelItem, searchQuery: string): boolean {
  if (!searchQuery.trim()) return true;
  const q = searchQuery.toLowerCase();
  const provider = m.source || m.owned_by || "";
  const matchesId = m.id.toLowerCase().includes(q);
  const matchesName = m.name?.toLowerCase().includes(q);
  const matchesProvider = provider.toLowerCase().includes(q);
  return Boolean(matchesId || matchesName || matchesProvider);
}

export function matchesProvider(m: ModelItem, selectedProvider: string): boolean {
  if (selectedProvider === "all") return true;
  const provider = m.source || m.owned_by || "";
  return provider.toLowerCase() === selectedProvider.toLowerCase();
}

export function matchesCapability(m: ModelItem, capabilityFilter: CapabilityFilter): boolean {
  if (capabilityFilter === "reasoning") return Boolean(m.reasoning);
  if (capabilityFilter === "fast") return !m.reasoning;
  if (capabilityFilter === "megacontext") {
    const ctx = m.context_window || m.context_length || 0;
    return ctx >= 256000;
  }
  if (capabilityFilter === "vision") {
    return Array.isArray(m.input) && m.input.includes("image");
  }
  return true;
}

export function matchesHealth(modelId: string, activeHealthChip: HealthFilter, pingResults: Record<string, PingResult>): boolean {
  if (activeHealthChip === "all") return true;
  const ping = pingResults[modelId];
  if (activeHealthChip === "ok") return ping?.status === "ok";
  if (activeHealthChip === "429") return ping?.status === "rate_limited";
  if (activeHealthChip === "error") return ping?.status === "error";
  return true;
}

export function matchesFilters(
  m: ModelItem,
  searchQuery: string,
  selectedProvider: string,
  activeHealthChip: HealthFilter,
  capabilityFilter: CapabilityFilter,
  pingResults: Record<string, PingResult>
): boolean {
  if (!matchesSearch(m, searchQuery)) return false;
  if (!matchesProvider(m, selectedProvider)) return false;
  if (!matchesCapability(m, capabilityFilter)) return false;
  return matchesHealth(m.id, activeHealthChip, pingResults);
}

export function compareByField(
  a: ModelItem,
  b: ModelItem,
  sortField: "model" | "reasoning" | "context" | "maxOutput" | "latency",
  sortAsc: boolean,
  pingResults: Record<string, PingResult>
): number {
  const dir = sortAsc ? 1 : -1;
  if (sortField === "model") return dir * a.id.localeCompare(b.id);
  if (sortField === "reasoning") {
    const scoreA = (a.reasoning ? 2 : 0) + (Array.isArray(a.input) && a.input.includes("image") ? 1 : 0);
    const scoreB = (b.reasoning ? 2 : 0) + (Array.isArray(b.input) && b.input.includes("image") ? 1 : 0);
    return dir * (scoreB - scoreA);
  }
  if (sortField === "context") {
    return dir * ((b.context_window || b.context_length || 0) - (a.context_window || a.context_length || 0));
  }
  if (sortField === "maxOutput") {
    return dir * ((b.max_tokens || b.maxTokens || 0) - (a.max_tokens || a.maxTokens || 0));
  }
  const pingA = pingResults[a.id];
  const pingB = pingResults[b.id];
  const latA = pingA?.status === "ok" && typeof pingA.latencyMs === "number" ? pingA.latencyMs : Infinity;
  const latB = pingB?.status === "ok" && typeof pingB.latencyMs === "number" ? pingB.latencyMs : Infinity;
  return dir * (latA - latB);
}

export function filterAndSortModels(options: FilterAndSortOptions): ModelItem[] {
  const {
    models,
    searchQuery,
    selectedProvider,
    activeHealthChip,
    capabilityFilter,
    sortField,
    sortAsc,
    pingResults,
  } = options;

  const list = models.filter((m) =>
    matchesFilters(m, searchQuery, selectedProvider, activeHealthChip, capabilityFilter, pingResults)
  );

  if (sortField !== "default") {
    list.sort((a, b) => compareByField(a, b, sortField, sortAsc, pingResults));
  }

  return list;
}
