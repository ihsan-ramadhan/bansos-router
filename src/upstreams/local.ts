
import { modelDef, type ModelDef, type Upstream } from "./types";

export interface LocalUpstreamConfig {
  // unique id, e.g. "freebuff"
  name: string;
  // local base url, e.g. "http://127.0.0.1:3457/v1"
  baseUrl: string;
  // optional bearer token (freebuff-proxy bridge mode)
  apiKey?: string;
}

// local gateways are reached directly; relay egress is off
export const LOCAL_RELAY_ALLOWED = false;

export function createLocalUpstream(cfg: LocalUpstreamConfig): Upstream {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return {
    id: `local:${cfg.name}`,
    kind: "local-openai",
    relayAllowed: LOCAL_RELAY_ALLOWED,
    chatUrl: `${base}/chat/completions`,

    async fetchCatalog(): Promise<ModelDef[] | null> {
      // TODO(M5): GET `${base}/models` and map entries to ModelDef (source: "local")
      return null;
    },

    requestHeaders(): Record<string, string> {
      return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
    },
  };
}
