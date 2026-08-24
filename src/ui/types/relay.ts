export type NotificationType = "success" | "info" | "error";

export interface ProbeStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  probing?: boolean;
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
}
