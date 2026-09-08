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
  // Muse only answers on /v1/responses; /chat/completions returns HTTP 500 even
  // with valid client headers, so these carry wireApi: "responses".
  modelDef({
    id: "muse-spark-1.3-contributor-free",
    name: "Muse Spark 1.3 Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
    wireApi: "responses",
  }),
  modelDef({
    id: "muse-spark-1.2-contributor-free",
    name: "Muse Spark 1.2 Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
    wireApi: "responses",
  }),
];

export const zenUpstream: Upstream = {
  id: "zen",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `${ZEN_BASE_URL}/chat/completions`,
  responsesUrl: `${ZEN_BASE_URL}/responses`,

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
        // probe on the wire the model actually speaks: a responses-only model
        // 500s on chat/completions and would be dropped as dead
        const responsesWire = m.wireApi === "responses";
        const probe = await fetch(
          responsesWire ? `${ZEN_BASE_URL}/responses` : `${ZEN_BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...ZEN_STATIC_HEADERS },
            body: JSON.stringify(
              responsesWire
                ? { model: m.id, input: "ping", max_output_tokens: 16, stream: false }
                : {
                    model: m.id,
                    messages: [{ role: "user", content: "ping" }],
                    max_tokens: 4,
                    stream: false,
                  },
            ),
            signal: AbortSignal.timeout(15000),
          },
        );
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
