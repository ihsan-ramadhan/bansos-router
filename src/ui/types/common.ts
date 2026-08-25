export type WireProtocol = "chat" | "responses" | "anthropic";

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
