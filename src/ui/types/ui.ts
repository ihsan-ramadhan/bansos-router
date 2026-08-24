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
  security?: {
    mode: "normal" | "strict";
    allowedUpstreams: string[];
    allowCrossProviderFailover: boolean;
  };
}

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

export interface RelayUpdatePayload {
  enabled?: boolean;
  url?: string;
  label?: string;
  action?: "add" | "remove";
  relays?: KnownRelay[];
}

export interface RelayStateResponse {
  enabled: boolean;
  url: string;
  relays: KnownRelay[];
  securityMode?: "normal" | "strict";
  locked?: boolean;
}

export interface PingResult {
  modelId: string;
  status: "idle" | "pinging" | "ok" | "rate_limited" | "error";
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

export interface ChatMessage {
  id?: string;
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
  metrics?: CompletionMetrics;
  error?: string;
}

export interface StreamEvent {
  id?: string;
  delta?: string;
  reasoning_content?: string;
  finish_reason?: string | null;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  raw?: string;
}

export interface CompletionMetrics {
  ttftMs?: number;
  totalMs?: number;
  tokenCount?: number;
  tokensPerSec?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}
