export interface ModelItem {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  source?: string;
  name?: string;
  context_window?: number;
  context_length?: number;
  max_tokens?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface ModelsResponse {
  object: string;
  data: ModelItem[];
}

export interface PingResult {
  modelId: string;
  status: "idle" | "pinging" | "ok" | "rate_limited" | "error";
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

export interface PingStats {
  total: number;
  ok: number;
  rateLimited: number;
  error: number;
  probing: number;
}

export interface PingSummary {
  total: number;
  ok: number;
  rateLimited: number;
  error: number;
}

export interface PingProgress {
  current: number;
  total: number;
}

export interface FilterAndSortOptions {
  models: ModelItem[];
  searchQuery: string;
  selectedProvider: string;
  activeHealthChip: "all" | "ok" | "429" | "error";
  capabilityFilter: "all" | "reasoning" | "fast" | "megacontext";
  sortField: "default" | "model" | "reasoning" | "context" | "maxOutput" | "latency";
  sortAsc: boolean;
  pingResults: Record<string, PingResult>;
}
