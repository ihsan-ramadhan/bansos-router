import { randomBytes } from "node:crypto";
import { restoreBridgedCalls } from "../protocols/tool-bridge";
import { modelDef, type ModelDef, type Upstream } from "./types";

const ZEN_INFERENCE_URL = "https://opencode.ai/inference/v1";
const ZEN_MODELS_URL = "https://opencode.ai/zen/v1";
export const MODELS_DEV_URL = "https://models.dev/api.json";

const OPENCODE_UA_FALLBACK = "1.18.31";
const OPENCODE_UA_VERSION_RE = /^\d+\.\d+\.\d+$/;
const OPENCODE_USER_AGENT_ENV = "BANSOS_OPENCODE_UA";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const OPENCODE_EXACT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read",
      description:
        "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory to read" },
          offset: { type: "number", description: "The line or directory entry to start reading from (1-based)" },
          limit: { type: "number", description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "shell",
      description:
        "Execute a shell command and return its output. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete. DO NOT poll for completion.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command string to execute" },
          workdir: { type: "string", description: "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead." },
          timeout: { type: "number", description: "Timeout in milliseconds. Set to 0 to disable the timeout." },
          background: { type: "boolean", description: "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion." },
        },
        required: ["command"],
      },
    },
  },
] as const;


const OPENCODE_PROJECT_ID = randomBytes(20).toString("hex");
const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const OPENCODE_RESPONSES_MODELS = new Set([
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);

let lastSessionTs = 0;
let sessionCounter = 0;

function unstableRandom(): string {
  const bytes = randomBytes(14);
  let out = "";
  for (let i = 0; i < 14; i++) out += BASE62[bytes[i]! % 62];
  return out;
}

const OPENCODE_ID_MASK = (1n << 48n) - 1n;

function timeHexFrom(value: bigint): string {
  const v = value & OPENCODE_ID_MASK;
  return Array.from({ length: 6 }, (_, i) =>
    Number((v >> BigInt(40 - 8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
}

function generateSessionId(timestamp = Date.now()): string {
  if (timestamp !== lastSessionTs) {
    lastSessionTs = timestamp;
    sessionCounter = 0;
  }
  sessionCounter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(sessionCounter);
  return `ses_${timeHexFrom(~current)}${unstableRandom()}`;
}

function generateRequestId(timestamp = Date.now()): string {
  const current = BigInt(timestamp) * 0x1000n + 1n;
  return `msg_${timeHexFrom(current)}${unstableRandom()}`;
}

const OPENCODE_SESSION = generateSessionId();
if (!OPENCODE_SESSION_RE.test(OPENCODE_SESSION)) {
  throw new Error("opencode session id generation failed shape check");
}

let liveOpenCodeVersion: string | null = null;

function getOpenCodeUA(): string {
  const override = process.env[OPENCODE_USER_AGENT_ENV]?.trim();
  if (override) return override.startsWith("opencode/") ? override : `opencode/${override}`;
  if (liveOpenCodeVersion && OPENCODE_UA_VERSION_RE.test(liveOpenCodeVersion))
    return `opencode/${liveOpenCodeVersion}`;
  return `opencode/${OPENCODE_UA_FALLBACK}`;
}

function opencodeHeaders(withRequestHeader = false): Record<string, string> {
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const headers: Record<string, string> = {
    "User-Agent": getOpenCodeUA(),
    authorization: "Bearer public",
    "x-opencode-client": "desktop",
    "x-opencode-project": OPENCODE_PROJECT_ID,
    "x-opencode-session": OPENCODE_SESSION,
    "x-opencode-session-id": OPENCODE_SESSION,
    "x-session-affinity": OPENCODE_SESSION,
    b3: `${traceId}-${spanId}-1-${spanId}`,
    traceparent: `00-${traceId}-${spanId}-01`,
    Accept: "text/event-stream",
  };
  if (withRequestHeader) headers["x-opencode-request"] = generateRequestId();
  return headers;
}

function toolNameOf(tool: unknown): string {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  const t = tool as Record<string, unknown>;
  const fn =
    t.function && typeof t.function === "object" && !Array.isArray(t.function)
      ? (t.function as Record<string, unknown>)
      : null;
  const raw =
    typeof t.name === "string"
      ? t.name
      : typeof fn?.name === "string"
        ? fn.name
        : "";
  return raw.trim();
}

// the Zen gate needs read/shell tool names present; add the exact ones only when missing, never rename the caller's
function ensureChatFingerprintTools(body: Record<string, unknown>): void {
  if (!Array.isArray(body.tools)) body.tools = [];
  const present = new Set<string>();
  for (const tool of body.tools as unknown[]) {
    const name = toolNameOf(tool);
    if (name) present.add(name);
  }
  for (const t of OPENCODE_EXACT_TOOLS) {
    if (present.has(t.function.name)) continue;
    (body.tools as unknown[]).push(structuredClone(t));
  }
}

function ensureResponsesFingerprintTools(body: Record<string, unknown>): void {
  const present = new Set<string>();
  if (!Array.isArray(body.tools)) body.tools = [];
  for (const tool of body.tools as unknown[]) {
    const name = toolNameOf(tool);
    if (name) present.add(name);
  }
  for (const t of OPENCODE_EXACT_TOOLS) {
    const name = t.function.name;
    if (present.has(name)) continue;
    (body.tools as unknown[]).push({
      type: "function",
      name,
      description: t.function.description,
      parameters: t.function.parameters,
    });
  }
}

function sanitizeResponsesItems(body: Record<string, unknown>): void {
  if (!Array.isArray(body.input)) return;
  body.input = (body.input as unknown[]).filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const it = item as Record<string, unknown>;
    if (it.type === "reasoning") return false;
    delete it.encrypted_content;
    delete it.reasoning_encrypted_content;
    return true;
  });
}

function transformOpencodeBody(
  body: Record<string, unknown>,
): { body: Record<string, unknown>; responsesPath: boolean } {
  body.stream = true;
  const model = typeof body.model === "string" ? body.model : "";
  if (OPENCODE_RESPONSES_MODELS.has(model) || model.includes("muse-spark")) {
    if (body.max_output_tokens === undefined) {
      if (typeof body.max_completion_tokens === "number")
        body.max_output_tokens = body.max_completion_tokens;
      else if (typeof body.max_tokens === "number")
        body.max_output_tokens = body.max_tokens;
    }
    delete body.max_tokens;
    delete body.max_completion_tokens;
    body.store = false;
    ensureResponsesFingerprintTools(body);
    sanitizeResponsesItems(body);
    return { body, responsesPath: true };
  }
  ensureChatFingerprintTools(body);
  return { body, responsesPath: false };
}

function transformOpencodeBodyChat(body: Record<string, unknown>): Record<string, unknown> {
  body.stream = true;
  ensureChatFingerprintTools(body);
  return body;
}

function transformOpencodeBodyResponses(body: Record<string, unknown>): Record<string, unknown> {
  if (body.max_output_tokens === undefined) {
    if (typeof body.max_completion_tokens === "number")
      body.max_output_tokens = body.max_completion_tokens;
    else if (typeof body.max_tokens === "number")
      body.max_output_tokens = body.max_tokens;
  }
  delete body.max_tokens;
  delete body.max_completion_tokens;
  body.store = false;
  body.stream = true;
  ensureResponsesFingerprintTools(body);
  sanitizeResponsesItems(body);
  return body;
}

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

export const ZEN_MODELS: ModelDef[] = [
  modelDef({
    id: "muse-spark-1.3-contributor-free",
    name: "Muse Spark 1.3 Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_048_576,
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
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    input: ["text", "image", "pdf"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
    wireApi: "responses",
  }),
  modelDef({
    id: "cat-jam-free",
    name: "Cat Jam Free",
    source: "zen",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 131_072,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "space-bunny-free",
    name: "Space Bunny Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 524_288,
    input: ["text", "image"],
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
    id: "longcat-2.5-preview-free",
    name: "LongCat 2.5 Preview Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
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
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "step-5-preview-free",
    name: "Step 5 Preview Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    input: ["text", "image"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
];


export const zenUpstream: Upstream = {
  id: "zen",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `${ZEN_INFERENCE_URL}/chat/completions`,
  responsesUrl: `${ZEN_INFERENCE_URL}/responses`,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    try {
      const [indexRes, listRes] = await Promise.all([
        fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) }).catch(() => null),
        fetch(`${ZEN_MODELS_URL}/models`, {
          headers: opencodeHeaders(true),
          signal: AbortSignal.timeout(6_000),
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
          responsesWire ? `${ZEN_INFERENCE_URL}/responses` : `${ZEN_INFERENCE_URL}/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...opencodeHeaders() },
            body: JSON.stringify(
              responsesWire
                ? {
                    model: m.id,
                    input: "ping",
                    max_output_tokens: 16,
                    stream: true,
                    tools: OPENCODE_EXACT_TOOLS.map(t => ({
                      type: "function",
                      name: t.function.name,
                      description: t.function.description,
                      parameters: t.function.parameters,
                    })),
                  }
                : {
                    model: m.id,
                    messages: [{ role: "user", content: "ping" }],
                    max_tokens: 4,
                    stream: true,
                    tools: OPENCODE_EXACT_TOOLS,
                    tool_choice: "none",
                  },
            ),
            signal: AbortSignal.timeout(15_000),
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
    return opencodeHeaders();
  },

  transformRequestBody(body: Record<string, unknown>, model: ModelDef): Record<string, unknown> {
    const own = {
      ...body,
      ...(Array.isArray(body.tools) ? { tools: [...body.tools] } : {}),
      ...(Array.isArray(body.messages) ? { messages: restoreBridgedCalls(body.messages) } : {}),
    };
    return model.wireApi === "responses" ? transformOpencodeBodyResponses(own) : transformOpencodeBodyChat(own);
  },
};