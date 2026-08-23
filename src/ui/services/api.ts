import type {
  DaemonStatus,
  ModelsResponse,
  AdapterSummary,
  AdapterRenderResponse,
  RelayStateResponse,
  RelayUpdatePayload,
} from "../types/ui";

const BASE_URL = "";

export async function fetchStatus(): Promise<DaemonStatus> {
  const res = await fetch(`${BASE_URL}/bansos/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch status`);
  return res.json();
}

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(`${BASE_URL}/v1/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch models`);
  return res.json();
}

export async function refreshCatalog(): Promise<{ refreshed: boolean; modelCount: number; alive: string[] }> {
  const res = await fetch(`${BASE_URL}/bansos/refresh`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to refresh catalog`);
  return res.json();
}

export async function fetchAdapters(): Promise<AdapterSummary[]> {
  const res = await fetch(`${BASE_URL}/bansos/adapters`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch adapters`);
  return res.json();
}

export async function renderAdapter(id: string, model?: string): Promise<AdapterRenderResponse> {
  const url = new URL(`${window.location.origin}/bansos/adapters/render`);
  url.searchParams.set("id", id);
  if (model) url.searchParams.set("model", model);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to render adapter ${id}`);
  return res.json();
}

export async function fetchRelayState(): Promise<RelayStateResponse> {
  const res = await fetch(`${BASE_URL}/bansos/relay`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch relay state`);
  return res.json();
}

export async function probeRelay(url?: string): Promise<{ ok: boolean; status?: number; latencyMs?: number; error?: string }> {
  const res = await fetch(`${BASE_URL}/bansos/relay/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(url ? { url } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to probe relay`);
  return res.json();
}

export async function updateRelayState(payload: RelayUpdatePayload): Promise<RelayStateResponse> {
  const res = await fetch(`${BASE_URL}/bansos/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to update relay state`);
  return res.json();
}

export async function pingModel(
  modelId: string,
  maxTokens?: number,
): Promise<{ latencyMs: number; status: number }> {
  const start = performance.now();
  // some upstreams reject requests with max_tokens below a minimum (e.g. 16),
  // so clamp the probe to at least 16 while never exceeding the model cap
  const probeTokens = maxTokens && maxTokens >= 16 ? maxTokens : 16;
  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bansos-no-failover": "1",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: probeTokens,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    const latencyMs = Math.round(performance.now() - start);
    return { latencyMs, status: res.status };
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return { latencyMs, status: 0 };
  }
}
