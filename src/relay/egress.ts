import { RELAY_STATE_FILE, readJson, writeJsonAtomic } from "../daemon/state";

// only known keyless upstream origins may be targeted via the relay
export const ALLOWED_TARGETS = [
  "https://opencode.ai",
  "https://api.kilo.ai",
  "https://llm7.io",
];

export interface KnownRelay {
  url: string;
  label?: string;
  addedAt?: string;
}

export interface RelayState {
  enabled: boolean;
  url: string;
  relays: KnownRelay[];
}

export function loadRelayState(): RelayState {
  const s = readJson<RelayState>(RELAY_STATE_FILE);
  return {
    enabled: Boolean(s?.enabled),
    url: typeof s?.url === "string" ? s.url : "",
    relays: Array.isArray(s?.relays) ? s.relays : [],
  };
}

export function saveRelayState(state: RelayState): void {
  writeJsonAtomic(RELAY_STATE_FILE, state);
}

function ensureRelay(state: RelayState, url: string, label?: string): void {
  const clean = url.trim();
  if (!clean || state.relays.some((r) => r.url === clean)) return;
  state.relays.push({ url: clean, label, addedAt: new Date().toISOString() });
}

// relay-aware fetch. direct when disabled; otherwise POST to the relay with
// the two relay headers. falls back to direct when the relay errors.
export async function relayFetch(
  state: RelayState,
  targetUrl: string,
  init: RequestInit = {},
  relayPermitted = true,
): Promise<Response> {
  if (!relayPermitted || !state.enabled || !state.url) return fetch(targetUrl, init);

  const u = new URL(targetUrl);
  if (!ALLOWED_TARGETS.includes(u.origin)) return fetch(targetUrl, init);

  try {
    const headers = new Headers(init.headers);
    headers.set("x-relay-target", u.origin);
    headers.set("x-relay-path", `${u.pathname}${u.search}`);
    return await fetch(state.url, {
      ...init,
      headers,
      body: init.body,
      duplex: "half",
    });
  } catch {
    return fetch(targetUrl, init); // non-strict fallback
  }
}

export function addRelay(state: RelayState, url: string, label?: string): RelayState {
  ensureRelay(state, url, label);
  return state;
}

export function removeRelay(state: RelayState, url: string): RelayState {
  state.relays = state.relays.filter((r) => r.url !== url);
  if (state.url === url) state.url = "";
  return state;
}
