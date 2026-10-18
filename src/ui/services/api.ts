import type {
  DaemonStatus,
  ModelsResponse,
  AdapterSummary,
  AdapterRenderResponse,
  RelayStateResponse,
  RelayUpdatePayload,
  UsageStats,
  ActivityEvent,
  ConfigState,
  DaemonSettings,
  DoctorReport,
  SetupResult,
} from "../types";

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
  // clamp the probe to at least 16 tokens (some upstreams reject less), never above the cap
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

export async function fetchUsage(window: "today" | "7d" | "30d" | "60d" | "all" = "all"): Promise<UsageStats> {
  const res = await fetch(`${BASE_URL}/bansos/usage?window=${window}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch usage`);
  return res.json();
}

export async function fetchEvents(limit = 100, window: "today" | "7d" | "30d" | "60d" | "all" = "all"): Promise<ActivityEvent[]> {
  const res = await fetch(`${BASE_URL}/bansos/events?limit=${limit}&window=${window}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch events`);
  const body = (await res.json()) as { events: ActivityEvent[] };
  return body.events;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function fetchConfig(): Promise<ConfigState> {
  const res = await fetch(`${BASE_URL}/bansos/config`);
  if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}: Failed to load settings`));
  return res.json();
}

export async function saveConfig(patch: Partial<DaemonSettings>): Promise<ConfigState> {
  const res = await fetch(`${BASE_URL}/bansos/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}: Failed to save settings`));
  return res.json();
}

export async function restartDaemon(): Promise<{ restarting: boolean; port: number; bind: string }> {
  const res = await fetch(`${BASE_URL}/bansos/restart`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}: Failed to restart`));
  return res.json();
}

export async function fetchLogs(lines = 200): Promise<{ path: string; lines: string[] }> {
  const res = await fetch(`${BASE_URL}/bansos/logs?lines=${lines}`);
  if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}: Failed to load logs`));
  return res.json();
}

export async function fetchDoctor(): Promise<DoctorReport> {
  const res = await fetch(`${BASE_URL}/bansos/doctor`);
  if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}: Failed to run health check`));
  return res.json();
}

export async function applyHarness(id: string, options: { model?: string; undo?: boolean } = {}): Promise<SetupResult> {
  const res = await fetch(`${BASE_URL}/bansos/adapters/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...options }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}: Failed to update ${id}`));
  return res.json();
}
