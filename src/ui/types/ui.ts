export interface DaemonStatus {
  status: string;
  uptimeSeconds: number;
  port: number;
  modelCount: number;
  models: string[];
  relay: {
    enabled: boolean;
    url: string;
  };
}

export interface ModelItem {
  id: string;
  object: string;
  created: number;
  owned_by: string;
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

export interface AdapterSummary {
  id: string;
  name: string;
  wire: "chat" | "anthropic" | "responses";
  configPaths: string[];
}

export interface ConfigWriteResult {
  path: string;
  content: string;
  mode: string;
}

export interface AdapterRenderResponse {
  id: string;
  name: string;
  wire: string;
  config: ConfigWriteResult[];
}

export interface KnownRelay {
  url: string;
  label?: string;
  addedAt?: string;
}

export interface RelayStateResponse {
  enabled: boolean;
  url: string;
  relays: KnownRelay[];
}

export interface PingResult {
  modelId: string;
  status: "idle" | "pinging" | "ok" | "rate_limited" | "error";
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}
