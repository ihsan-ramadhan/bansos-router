export type ActivityKind = "chat" | "responses" | "anthropic";
export type ActivityStatus = "ok" | "error";

export interface ActivityEvent {
  id: number;
  timestamp: number;
  kind: ActivityKind;
  model: string;
  requestedModel: string;
  upstream: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: ActivityStatus;
  failoverFrom?: string;
}

export interface ModelActivity {
  requests: number;
  ok: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UpstreamActivity {
  requests: number;
  ok: number;
}

export interface UsageStats {
  totalRequests: number;
  okRequests: number;
  errorRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  failoverCount: number;
  avgDurationMs: number;
  perModel: Record<string, ModelActivity>;
  perUpstream: Record<string, UpstreamActivity>;
}
