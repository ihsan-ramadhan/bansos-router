import { randomBytes } from "node:crypto";
import { modelDef, type ModelDef, type Upstream } from "./types";

export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const ZEN_USER_AGENT = "opencode/latest/2.0.5/cli";
export const MODELS_DEV_URL = "https://models.dev/api.json";

interface ModelsDevModel {
  name?: string;
  reasoning?: boolean;
  status?: string;
  cost?: { input?: number };
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[] };
}

interface ModelsDevIndex {
  opencode?: { models?: Record<string, ModelsDevModel> };
}

function discardBody(res: Response | null): void {
  void res?.body?.cancel().catch(() => {});
}

export const ZEN_CHAT_MODALITIES = new Set(["text", "image"]);
export const ZEN_RESPONSES_MODALITIES = new Set(["text", "image", "pdf"]);

export function zenModelFromIndex(id: string, m: ModelsDevModel): ModelDef {
  const seed = ZEN_MODELS.find((s) => s.id === id);
  const wireApi = seed?.wireApi;
  const deliverable = wireApi === "responses" ? ZEN_RESPONSES_MODALITIES : ZEN_CHAT_MODALITIES;
  const modalities = (m.modalities?.input ?? seed?.input ?? ["text"]).filter((i) =>
    deliverable.has(i),
  ) as ModelDef["input"];
  return modelDef({
    id,
    name: m.name ?? seed?.name ?? id,
    source: "zen",
    reasoning: m.reasoning ?? seed?.reasoning ?? false,
    contextWindow: m.limit?.context ?? seed?.contextWindow ?? 128_000,
    maxTokens: m.limit?.output ?? seed?.maxTokens ?? 16_384,
    input: modalities.length > 0 ? modalities : ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
    ...(wireApi ? { wireApi } : {}),
  });
}

const opencodeIDAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function opencodeDescendingID(): string {
  const now = BigInt(Date.now());
  const a = ~(now * 0x1000n + 1n);
  const time = Array.from({ length: 6 }, (_, D) =>
    Number((a >> BigInt(40 - 8 * D)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
  const bytes = randomBytes(14);
  const rand = Array.from(bytes, (b) => opencodeIDAlphabet[b % 62]).join("");
  return time + rand;
}

export const ZEN_SPOOF_TOOLS_CHAT = [
  { type: "function", function: { name: "read", description: "Read file contents", parameters: { type: "object" } } },
  { type: "function", function: { name: "shell", description: "Execute shell command", parameters: { type: "object" } } },
];

export const ZEN_SPOOF_TOOLS_RESPONSES = [
  { type: "function", name: "read", description: "Read file contents", parameters: { type: "object" } },
  { type: "function", name: "shell", description: "Execute shell command", parameters: { type: "object" } },
];

// pinned zen free models verified keyless on the chat completions wire
export const ZEN_MODELS: ModelDef[] = [
  modelDef({
    id: "mimo-v2.6-flash-free",
    name: "MiMo V2.6 Flash Free",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
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
    input: ["text", "image", "pdf"],
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
    input: ["text", "image", "pdf"],
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
      const [indexRes, listRes] = await Promise.all([
        fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(10000) }).catch(() => null),
        fetch(`${ZEN_BASE_URL}/models`, {
          headers: this.requestHeaders(),
          signal: AbortSignal.timeout(6000),
        }),
      ]);

      let index: ModelsDevIndex | null = null;
      if (indexRes?.ok) index = (await indexRes.json()) as ModelsDevIndex;
      else discardBody(indexRes);

      if (!listRes.ok) {
        discardBody(listRes);
        return null;
      }

      const listing = (await listRes.json()) as { data?: { id: string }[] };
      const listed = new Set((listing.data ?? []).map((m) => m.id));
      if (listed.size === 0) return null;

      const kept: ModelDef[] = [];
      const unservable = new Set<string>();
      for (const [id, m] of Object.entries(index?.opencode?.models ?? {})) {
        if (m?.status === "deprecated" || m?.cost?.input !== 0) {
          unservable.add(id);
          continue;
        }
        if (!listed.has(id)) continue;
        kept.push(zenModelFromIndex(id, m));
      }

      const resolved = new Set(kept.map((m) => m.id));
      for (const m of ZEN_MODELS) {
        if (resolved.has(m.id)) continue;
        if (listed.has(m.id) && !unservable.has(m.id)) {
          kept.push(m);
          continue;
        }
        const responsesWire = m.wireApi === "responses";
        const probe = await fetch(
          responsesWire ? `${ZEN_BASE_URL}/responses` : `${ZEN_BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...this.requestHeaders(m) },
            body: JSON.stringify(
              responsesWire
                ? {
                    model: m.id,
                    input: "ping",
                    max_output_tokens: 16,
                    stream: true,
                    tools: ZEN_SPOOF_TOOLS_RESPONSES,
                  }
                : {
                    model: m.id,
                    messages: [{ role: "user", content: "ping" }],
                    max_tokens: 4,
                    stream: true,
                    tools: ZEN_SPOOF_TOOLS_CHAT,
                    tool_choice: "none",
                  },
            ),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (probe.ok) kept.push(m);
      }

      if (kept.length === 0) return null;
      return kept;
    } catch {
      return null;
    }
  },

  requestHeaders(_model?: ModelDef): Record<string, string> {
    const session = `ses_${opencodeDescendingID()}`;
    const project = randomBytes(20).toString("hex");
    const traceId = randomBytes(16).toString("hex");
    const spanId = randomBytes(8).toString("hex");
    return {
      authorization: "Bearer public",
      "User-Agent": ZEN_USER_AGENT,
      "x-opencode-client": "cli",
      "x-opencode-project": project,
      "x-opencode-session": session,
      "x-session-affinity": session,
      "x-session-id": session,
      b3: `${traceId}-${spanId}-1-${spanId}`,
      traceparent: `00-${traceId}-${spanId}-01`,
    };
  },

  transformRequestBody(body: Record<string, unknown>, model: ModelDef): Record<string, unknown> {
    const transformed = { ...body };
    const responsesWire = model.wireApi === "responses";

    transformed.stream = true;

    if (responsesWire) {
      if (!Array.isArray(transformed.tools) || transformed.tools.length === 0) {
        transformed.tools = [...ZEN_SPOOF_TOOLS_RESPONSES];
      } else {
        const tools = [...(transformed.tools as Array<{ name?: string }>)];
        const names = new Set(tools.map((t) => t?.name));
        for (const t of ZEN_SPOOF_TOOLS_RESPONSES) {
          if (!names.has(t.name)) tools.push(t);
        }
        transformed.tools = tools;
      }
    } else {
      if (!Array.isArray(transformed.tools) || transformed.tools.length === 0) {
        transformed.tools = [...ZEN_SPOOF_TOOLS_CHAT];
        if (!transformed.tool_choice) transformed.tool_choice = "none";
      } else {
        const tools = [...(transformed.tools as Array<{ function?: { name?: string }; name?: string }>)];
        const names = new Set(tools.map((t) => t?.function?.name ?? t?.name));
        for (const t of ZEN_SPOOF_TOOLS_CHAT) {
          if (!names.has(t.function.name)) tools.push(t);
        }
        transformed.tools = tools;
      }
    }

    return transformed;
  },
};
