import { randomUUID } from "node:crypto";
import { modelDef, type ModelDef, type Upstream } from "./types";

export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const ZEN_USER_AGENT = "opencode/latest/1.14.50/cli";

const ZEN_STATIC_HEADERS = {
  "User-Agent": ZEN_USER_AGENT,
  "x-opencode-client": "cli",
  "x-opencode-project": "default",
};

// pinned zen free models verified keyless on the chat completions wire
export const ZEN_MODELS: ModelDef[] = [
  modelDef({
    id: "mimo-v2.5-free",
    name: "Mimo V2.5 Free",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "big-pickle",
    name: "Big Pickle",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "laguna-s-2.1-free",
    name: "Laguna S 2.1",
    source: "zen",
    reasoning: true,
    contextWindow: 256_000,
    maxTokens: 32_000,
    input: ["text"],
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nemotron-3.5-lightning-free",
    name: "Nemotron 3.5 Lightning Free",
    source: "zen",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 262_144,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "ling-3.0-flash-fin-free",
    name: "Ling 3.0 Flash Fin Free",
    source: "zen",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
];

export const zenUpstream: Upstream = {
  id: "zen",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `${ZEN_BASE_URL}/chat/completions`,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    try {
      const res = await fetch(`${ZEN_BASE_URL}/models`, {
        headers: ZEN_STATIC_HEADERS,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { id: string }[] };
      const listed = new Set((body.data ?? []).map((m) => m.id));
      if (listed.size === 0) return null;

      const kept: ModelDef[] = [];
      for (const m of ZEN_MODELS) {
        if (listed.has(m.id)) {
          kept.push(m);
          continue;
        }
        const probe = await fetch(`${ZEN_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...ZEN_STATIC_HEADERS },
          body: JSON.stringify({
            model: m.id,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 4,
            stream: false,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (probe.ok) kept.push(m);
      }
      if (kept.length === 0) return null; // transient gap: keep last-known
      return kept;
    } catch {
      return null;
    }
  },

  requestHeaders(): Record<string, string> {
    return {
      ...ZEN_STATIC_HEADERS,
      "x-opencode-session": randomUUID(),
      "x-opencode-request": randomUUID(),
    };
  },
};
