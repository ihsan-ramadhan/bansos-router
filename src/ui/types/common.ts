export type WireProtocol = "chat" | "responses" | "anthropic";

export interface DaemonStatus {
  status: string;
  uptimeSeconds: number;
  port: number;
  modelCount: number;
  models: string[];
  providers?: Array<{ id: string; models: number; allowed: boolean }>;
  relay: {
    enabled: boolean;
    url: string;
  };
  security?: {
    mode: "normal" | "strict";
    dlp?: "redact" | "block";
    allowedUpstreams: string[];
    allowCrossProviderFailover: boolean;
  };
}
