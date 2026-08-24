import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import type { Logger } from "../logger";
import type { ModelDef, Upstream } from "../upstreams/types";
import { parseChatTurn, sanitizeChatBody } from "../protocols/openai-chat";
import { parseResponsesTurn, renderResponse, ResponsesStreamEncoder } from "../protocols/responses";
import {
  parseAnthropicRequest,
  openAiCompletionToAnthropicMessage,
  AnthropicStreamEncoder,
} from "../protocols/anthropic";
import {
  loadRelayState,
  saveRelayState,
  addRelay,
  removeRelay,
  relayFetch,
  type RelayState,
} from "../relay/egress";
import { ADAPTERS, findAdapter } from "../adapters";
import { readSseStream } from "../protocols/stream";
import type { RuntimeCatalog } from "./catalog";
import type { RateLimiter } from "./rate-limit";

export interface StatusPayload {
  status: "ok";
  uptimeSeconds: number;
  port: number;
  modelCount: number;
  models: string[];
  relay?: { enabled: boolean; url: string };
}

export interface ServerOptions {
  catalog: RuntimeCatalog;
  rateLimiter: RateLimiter;
  port: number;
  log: Logger;
  startedAt: number;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS"]);

function applyRelayMutation(
  initialState: RelayState,
  body: Record<string, unknown>,
): RelayState {
  let current = { ...initialState };
  if (typeof body.enabled === "boolean") {
    current.enabled = body.enabled;
  }
  const label = typeof body.label === "string" ? body.label : undefined;
  if (!body.action && typeof body.url === "string") {
    current.url = body.url;
    if (body.url && !current.relays.some((r: import("../relay/egress").KnownRelay) => r.url === body.url)) {
      current = addRelay(current, body.url, label);
    }
  } else if (body.action === "add" && typeof body.url === "string") {
    current = addRelay(current, body.url, label);
  } else if (body.action === "remove" && typeof body.url === "string") {
    current = removeRelay(current, body.url);
  }
  if (Array.isArray(body.relays)) {
    current.relays = body.relays as import("../relay/egress").KnownRelay[];
  }
  return current;
}
const STATIC_ROOT_FILES = new Set([
  "/",
  "/index.html",
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.json",
  "/robots.txt",
]);

const API_EXACT_PATHS = new Set([
  "/healthz",
  "/healthz/",
  "/bansos/status",
  "/bansos/status/",
  "/bansos/refresh",
  "/bansos/refresh/",
  "/bansos/adapters",
  "/bansos/adapters/",
  "/bansos/adapters/render",
  "/bansos/adapters/render/",
  "/bansos/relay",
  "/bansos/relay/",
  "/bansos/relay/probe",
  "/bansos/relay/probe/",
  "/chat/completions",
  "/chat/completions/",
  "/messages",
  "/messages/",
  "/responses",
  "/responses/",
  "/models",
  "/models/",
  "/v1/chat/completions",
  "/v1/chat/completions/",
  "/v1/messages",
  "/v1/messages/",
  "/v1/responses",
  "/v1/responses/",
  "/v1/models",
  "/v1/models/",
]);

function isAllowedInboundPath(pathname: string): boolean {
  if (STATIC_ROOT_FILES.has(pathname) || API_EXACT_PATHS.has(pathname)) {
    return true;
  }
  return pathname.startsWith("/assets/") && /^[\w.-]+$/.test(pathname.slice(8));
}

// how many fallback models to try after the primary rejects with 429/5xx.
// total attempts = 1 + MAX_FAILOVER_RETRIES.
const MAX_FAILOVER_RETRIES = 2;

// CORS headers applied to every response (not just preflight) so browser
// clients (web UIs, extensions) can call the daemon after a passed preflight.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
} as const;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function getUiDistDir(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);
    const candidate1 = path.resolve(currentDir, "../../dist/ui");
    if (fs.existsSync(candidate1)) return candidate1;
    const candidate2 = path.resolve(currentDir, "../ui");
    if (fs.existsSync(candidate2)) return candidate2;
  } catch {
    // fallback
  }
  const candidate3 = path.resolve(process.cwd(), "dist/ui");
  if (fs.existsSync(candidate3)) return candidate3;
  return path.resolve(process.cwd(), "dist/ui");
}

function serveStaticUi(res: http.ServerResponse, reqPath: string): void {
  const uiDir = getUiDistDir();
  let relativePath = reqPath.replace(/^\/+/, "");
  if (!relativePath || relativePath === "index.html") {
    relativePath = "index.html";
  }

  const filePath = path.join(uiDir, relativePath);

  // Security guard against path traversal outside uiDir
  if (!filePath.startsWith(uiDir)) {
    sendJson(res, 403, { error: { message: "forbidden" } });
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": content.length,
      ...CORS_HEADERS,
    });
    res.end(content);
    return;
  }

  // If a specific static asset was requested and doesn't exist, return 404
  if (relativePath.startsWith("assets/")) {
    sendJson(res, 404, { error: { message: "asset not found" } });
    return;
  }

  // If index.html requested or SPA route but file missing, check if index.html exists
  const indexPath = path.join(uiDir, "index.html");
  if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
    const content = fs.readFileSync(indexPath);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": content.length,
      ...CORS_HEADERS,
    });
    res.end(content);
    return;
  }

  // Fallback if UI is not yet built
  const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>bansos-router</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#111113;color:#f4f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1.5rem;box-sizing:border-box;">
  <div style="max-width:460px;width:100%;text-align:center;background:#16161a;border:1px solid #23232a;border-radius:1rem;padding:2.5rem 2rem;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
    <div style="display:inline-flex;align-items:center;justify-content:center;width:3rem;height:3rem;border-radius:0.75rem;background:#202028;border:1px solid #2c2c36;margin-bottom:1.25rem;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
    </div>
    <h1 style="font-size:1.25rem;font-weight:700;margin:0 0 0.5rem 0;color:#ffffff;letter-spacing:-0.025em;">bansos-router daemon is online</h1>
    <p style="font-size:0.875rem;color:#9393a0;margin:0 0 1.5rem 0;line-height:1.5;">Web UI bundle is not built yet. Run <code style="background:#202028;border:1px solid #2c2c36;padding:0.2rem 0.4rem;border-radius:0.375rem;color:#60a5fa;font-family:monospace;font-size:0.8125rem;">npm run build</code> to compile the dashboard.</p>
    <div style="font-size:0.75rem;color:#71717a;border-top:1px solid #23232a;padding-top:1rem;line-height:1.6;">
      API live at <span style="font-family:monospace;color:#a1a1aa;">/v1/chat/completions</span> & <span style="font-family:monospace;color:#a1a1aa;">/v1/models</span>
    </div>
  </div>
</body>
</html>`;
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(fallbackHtml),
    ...CORS_HEADERS,
  });
  res.end(fallbackHtml);
}

function validatePath(rawUrl: string): boolean {
  const pathname = rawUrl.split("?")[0] ?? "/";
  const cleaned = pathname.replace(/^\/+/, "");
  const withSlash = `/${cleaned}`;
  if (withSlash.includes("..")) return false;
  try {
    const decoded = decodeURIComponent(withSlash);
    if (decoded !== withSlash) return false; // encoded variants not accepted (v1)
  } catch {
    return false;
  }
  return true;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

async function readBody(
  req: http.IncomingMessage,
  cap = 10 * 1024 * 1024,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > cap) throw new Error("request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// openai chat in -> resolve model -> forward raw body to its upstream
// stream the response back unchanged (keyless upstreams speak openai chat)

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function extractUsage(json: unknown): TokenUsage | null {
  const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
    ?.usage;
  if (!usage || usage.prompt_tokens == null || usage.completion_tokens == null) return null;
  return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
}

// finds the first complete `"usage": {...}` object in a tail of SSE bytes,
// tolerating nested braces (e.g. completion_tokens_details).
function findUsageObject(tail: string): Record<string, unknown> | null {
  const open = tail.search(/"usage"\s*:\s*\{/);
  if (open < 0) return null;
  const start = tail.indexOf("{", open);
  let depth = 0;
  for (let i = start; i < tail.length; i++) {
    const ch = tail[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(tail.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// pass-through that watches the tail of the SSE bytes for a usage object and
// logs it once, ensuring a terminating `data: [DONE]` frame is emitted if missing.
export function logUsageTransform(model: string, upstream: string, log: Logger, startedAt: number): Transform {
  let tail = "";
  let reported = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      tail = `${tail}${chunk.toString("utf8")}`.slice(-16384);
      if (!reported) {
        const obj = findUsageObject(tail);
        if (obj) {
          const usage = extractUsage({ usage: obj });
          if (usage) {
            reported = true;
            log.info("chat done", { model, upstream, durationMs: Date.now() - startedAt, ...usage });
          }
        }
      }
      cb(null, chunk);
    },
    flush(cb) {
      // guarantee terminating [DONE] frame so clients with strict SSE parsers never hang/retry
      if (!tail.includes("[DONE]")) {
        this.push("\ndata: [DONE]\n\n");
      }
      cb();
    },
  });
}

export function pickFailover(
  catalog: RuntimeCatalog,
  origin: ModelDef,
  attempts: ReadonlySet<string> = new Set(),
): ModelDef | undefined {
  let best: ModelDef | undefined;
  let bestScore = Number.POSITIVE_INFINITY; // lower is better
  for (const candidate of catalog.models) {
    if (candidate.id === origin.id) continue;
    if (attempts.has(candidate.id)) continue;
    if (candidate.source === origin.source) continue;
    if (candidate.reasoning !== origin.reasoning) continue;
    if (candidate.compat.supportsDeveloperRole !== origin.compat.supportsDeveloperRole) continue;
    if (candidate.compat.supportsReasoningEffort !== origin.compat.supportsReasoningEffort) continue;
    if (candidate.contextWindow < origin.contextWindow) continue;

    const score = (candidate.contextWindow - origin.contextWindow) * 1_000_000 - candidate.maxTokens;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
// shared forward+failover core used by both /v1/chat/completions and
// /v1/responses. resolves the model, sanitizes, then retries the chosen
// upstream with failover on 429/5xx. returns the final upstream Response plus
// the model that served it, or a terminal error to forward to the client.
type ForwardResult = { response: Response; model: ModelDef; upstream: Upstream };
type ForwardError = { status: number; message: string };
async function runChatForward(
  req: http.IncomingMessage,
  catalog: RuntimeCatalog,
  log: Logger,
  parsedModel: string,
  sanitizedBody: Record<string, unknown>,
  stream: boolean,
): Promise<ForwardResult | ForwardError> {
  const model = catalog.resolve(parsedModel);
  if (!model) {
    return { status: 400, message: `unknown model: ${parsedModel}` };
  }
  const upstream = catalog.upstreamBySource(model.source);
  if (!upstream) {
    return { status: 502, message: `no upstream for source: ${model.source}` };
  }

  const requestStartedAt = Date.now();
  const relay = loadRelayState();
  const noFailover = req.headers["x-bansos-no-failover"] === "1";
  const tried = new Set<string>([model.id]);
  let current: ModelDef = model;
  let currentUpstream = catalog.upstreamBySource(current.source)!;
  let transientError: ForwardError | null = null;

  for (let attempt = 0; attempt <= MAX_FAILOVER_RETRIES; attempt++) {
    if (current.id !== model.id || attempt > 0) {
      log.warn("upstream rejected — fallback used", {
        from: model.id,
        to: current.id,
        fromUpstream: currentUpstream.id,
        status: transientError?.status,
        durationMs: Date.now() - requestStartedAt,
        attempt,
        error: transientError?.message.slice(0, 100),
      });
    }

    const headers = new Headers({
      "content-type": "application/json",
      ...currentUpstream.requestHeaders(current),
    });
    const outboundBody = JSON.stringify({ ...sanitizedBody, model: current.id });

    let upstreamRes: Response;
    try {
      upstreamRes = await relayFetch(relay, currentUpstream.chatUrl, {
        method: "POST",
        headers,
        body: outboundBody,
        duplex: "half",
      });
    } catch (err) {
      transientError = { status: 0, message: String(err) };
      const next = noFailover ? undefined : pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    if (upstreamRes.status >= 400) {
      const text = await upstreamRes.text();
      let errorMsg = text.slice(0, 256) || "upstream error";
      try {
        const json = JSON.parse(text);
        errorMsg = json?.error?.message ?? json?.message ?? errorMsg;
      } catch {
        // ignore parse failure; raw text stands as error message
      }

      const transient = upstreamRes.status === 429 || upstreamRes.status >= 500;
      if (!transient) {
        log.warn("upstream rejected", {
          model: current.id,
          upstream: currentUpstream.id,
          status: upstreamRes.status,
          durationMs: Date.now() - requestStartedAt,
          error: errorMsg.slice(0, 100),
        });
        return { status: upstreamRes.status, message: errorMsg };
      }

      transientError = { status: upstreamRes.status, message: errorMsg };
      const next = noFailover ? undefined : pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    return { response: upstreamRes, model: current, upstream: currentUpstream };
  }

  return transientError ?? { status: 502, message: "no upstream candidates left" };
}

async function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
): Promise<void> {
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    sendJson(res, 413, { error: { message: "request body too large" } });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    sendJson(res, 400, { error: { message: "invalid JSON body" } });
    return;
  }

  const parsed = parseChatTurn(body);
  if (!parsed.ok) {
    sendJson(res, 400, { error: { message: parsed.error } });
    return;
  }

  const requestStartedAt = Date.now();
  const sanitizedBody = sanitizeChatBody(
    body as Record<string, unknown>,
    catalog.resolve(parsed.value.model)?.compat.supportsDeveloperRole ?? false,
  ) as Record<string, unknown>;
  if (parsed.value.stream) {
    sanitizedBody.stream_options = { include_usage: true };
  }

  const result = await runChatForward(
    req,
    catalog,
    log,
    parsed.value.model,
    sanitizedBody,
    parsed.value.stream,
  );
  if ("status" in result) {
    sendJson(res, result.status, {
      error: { message: result.message, type: "upstream_error", status: result.status },
    });
    return;
  }

  const { response: upstreamRes, model: current, upstream: currentUpstream } = result;
  const model = catalog.resolve(parsed.value.model) ?? current;
  log.info("chat → upstream", {
    model: current.id,
    upstream: currentUpstream.id,
    stream: parsed.value.stream,
  });

  // 2xx: forward the response, capturing token usage on the way
  const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
  res.writeHead(upstreamRes.status, { "content-type": contentType, ...CORS_HEADERS });

  if (!parsed.value.stream) {
    // non-stream: buffer once to read usage, then forward the exact bytes
    const text = await upstreamRes.text();
    try {
      const usage = extractUsage(JSON.parse(text));
      if (usage) {
        const fields: Record<string, unknown> = {
          model: current.id,
          upstream: currentUpstream.id,
          durationMs: Date.now() - requestStartedAt,
          ...usage,
        };
        if (current.id !== model.id) fields.failoverFrom = model.id;
        log.info("chat done", fields);
      }
    } catch {
      // usage is informational only; the plain response still goes out
    }
    res.end(text);
    return;
  }

  if (upstreamRes.body) {
    Readable.fromWeb(
      upstreamRes.body as import("node:stream/web").ReadableStream,
    )
      .pipe(logUsageTransform(current.id, currentUpstream.id, log, requestStartedAt))
      .pipe(res);
  } else {
    res.end();
  }
}

// Codex CLI (wire_api = "responses") -> translate to openai chat -> forward ->
// translate back into responses-shaped output.
async function handleResponses(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
): Promise<void> {
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    sendJson(res, 413, { error: { message: "request body too large" } });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    sendJson(res, 400, { error: { message: "invalid JSON body" } });
    return;
  }

  const parsed = parseResponsesTurn(body);
  if (!parsed.ok) {
    sendJson(res, 400, { error: { message: parsed.error } });
    return;
  }

  const requestStartedAt = Date.now();
  const target = catalog.resolve(parsed.value.model);
  const supportsDev = target?.compat.supportsDeveloperRole ?? false;

  // build the openai chat body from the parsed responses turn
  const chatMessages: any[] = [];
  if (parsed.value.system) {
    chatMessages.push({ role: "system", content: parsed.value.system });
  }
  for (const m of parsed.value.messages) {
    chatMessages.push({
      role: m.role,
      content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      ...(m.toolCalls
        ? { tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })) }
        : {}),
    });
  }

  const sanitizedBody: Record<string, unknown> = sanitizeChatBody(
    {
      model: parsed.value.model,
      messages: chatMessages,
      ...(parsed.value.tools
        ? {
            tools: parsed.value.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      ...(parsed.value.maxTokens ? { max_tokens: parsed.value.maxTokens } : {}),
      ...(parsed.value.reasoningEffort ? { reasoning_effort: parsed.value.reasoningEffort } : {}),
      stream: parsed.value.stream,
    },
    supportsDev,
  ) as Record<string, unknown>;
  if (parsed.value.stream) {
    sanitizedBody.stream_options = { include_usage: true };
  }

  const result = await runChatForward(
    req,
    catalog,
    log,
    parsed.value.model,
    sanitizedBody,
    parsed.value.stream,
  );
  if ("status" in result) {
    sendJson(res, result.status, {
      error: { message: result.message, type: "upstream_error", status: result.status },
    });
    return;
  }

  const { response: upstreamRes, model: current, upstream: currentUpstream } = result;
  const resolved = catalog.resolve(parsed.value.model) ?? current;
  log.info("responses → upstream", {
    model: current.id,
    upstream: currentUpstream.id,
    stream: parsed.value.stream,
  });

  if (!parsed.value.stream) {
    const text = await upstreamRes.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      sendJson(res, 502, { error: { message: "invalid upstream response" } });
      return;
    }
    const usage = extractUsage(json);
    if (usage) {
      const fields: Record<string, unknown> = {
        model: current.id,
        upstream: currentUpstream.id,
        durationMs: Date.now() - requestStartedAt,
        ...usage,
      };
      if (current.id !== resolved.id) fields.failoverFrom = resolved.id;
      log.info("responses done", fields);
    }
    const out = renderResponse(json, current.id);
    res.writeHead(upstreamRes.status, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify(out));
    return;
  }

  // streaming: translate upstream openai sse -> responses sse events
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    ...CORS_HEADERS,
  });
  const encoder = new ResponsesStreamEncoder();
  let first = true;
  let streamUsage: TokenUsage | null = null;
  if (upstreamRes.body) {
    for await (const frame of readSseStream(
      upstreamRes.body as unknown as import("node:stream/web").ReadableStream,
    )) {
      if (frame.data === "[DONE]") continue;
      let json: any;
      try { json = JSON.parse(frame.data); } catch { continue; }
      if (first) {
        first = false;
        for (const ev of encoder.open(current.id)) res.write(ev);
      }
      const usage = extractUsage(json);
      if (usage) streamUsage = usage;
      for (const ev of encoder.push(json)) res.write(ev);
    }
  }
  for (const ev of encoder.close()) res.write(ev);
  if (streamUsage) {
    const fields: Record<string, unknown> = {
      model: current.id,
      upstream: currentUpstream.id,
      durationMs: Date.now() - requestStartedAt,
      ...streamUsage,
    };
    if (current.id !== resolved.id) fields.failoverFrom = resolved.id;
    log.info("responses done", fields);
  }
  res.end();
}

// anthropic messages in -> translate to openai chat -> forward -> translate back
async function handleAnthropic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
): Promise<void> {
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    sendAnthropicError(res, 413, "request body too large");
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    sendAnthropicError(res, 400, "invalid JSON body");
    return;
  }

  const parsed = parseAnthropicRequest(body);
  if (!parsed.ok) {
    sendAnthropicError(res, 400, parsed.error);
    return;
  }

  const model = catalog.resolve(parsed.value.model);
  if (!model) {
    sendAnthropicError(res, 400, `unknown model: ${parsed.value.model}`);
    return;
  }

  const upstream = catalog.upstreamBySource(model.source);
  if (!upstream) {
    sendAnthropicError(res, 502, `no upstream for source: ${model.source}`);
    return;
  }

  const requestStartedAt = Date.now();
  const chatBody = parsed.value.chatBody as Record<string, unknown>;
  chatBody.model = model.id;
  // defensive cap: pin max_tokens to the model's actual limit so a stale
  // client value (or wrong metadata) never reaches the upstream
  if (typeof chatBody.max_tokens === "number" && chatBody.max_tokens > model.maxTokens) {
    chatBody.max_tokens = model.maxTokens;
  }

  log.info("anthropic → upstream", {
    model: model.id,
    upstream: upstream.id,
    stream: parsed.value.stream,
  });

  const relay = loadRelayState();
  const tried = new Set<string>([model.id]);
  let current: ModelDef = model;
  let currentUpstream = catalog.upstreamBySource(current.source)!;
  let transientError: { status: number; errorMsg: string } | null = null;

  for (let attempt = 0; attempt <= MAX_FAILOVER_RETRIES; attempt++) {
    if (current.id !== model.id || attempt > 0) {
      log.warn("upstream rejected — fallback used", {
        from: model.id,
        to: current.id,
        fromUpstream: currentUpstream.id,
        status: transientError?.status,
        durationMs: Date.now() - requestStartedAt,
        attempt,
        error: transientError?.errorMsg.slice(0, 100),
      });
    }

    const headers = new Headers({
      "content-type": "application/json",
      ...currentUpstream.requestHeaders(current),
    });
    const outboundBody = JSON.stringify({ ...chatBody, model: current.id });

    let upstreamRes: Response;
    try {
      upstreamRes = await relayFetch(relay, currentUpstream.chatUrl, {
        method: "POST",
        headers,
        body: outboundBody,
        duplex: "half",
      });
    } catch (err) {
      transientError = { status: 0, errorMsg: String(err) };
      const next = pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    if (upstreamRes.status >= 400) {
      const text = await upstreamRes.text();
      let errorMsg = text.slice(0, 256) || "upstream error";
      try {
        const json = JSON.parse(text);
        errorMsg = json?.error?.message ?? json?.message ?? errorMsg;
      } catch {
        // ignore
      }

      const transient = upstreamRes.status === 429 || upstreamRes.status >= 500;
      if (!transient) {
        log.warn("upstream rejected", {
          model: current.id,
          upstream: currentUpstream.id,
          status: upstreamRes.status,
          durationMs: Date.now() - requestStartedAt,
          error: errorMsg.slice(0, 100),
        });
        sendAnthropicError(res, upstreamRes.status, errorMsg);
        return;
      }

      transientError = { status: upstreamRes.status, errorMsg };
      const next = pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    if (!parsed.value.stream) {
      const text = await upstreamRes.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        sendAnthropicError(res, 502, "invalid upstream response");
        return;
      }
      const message = openAiCompletionToAnthropicMessage(json, current.id);
      const usage = extractUsage(json);
      if (usage) {
        const fields: Record<string, unknown> = {
          model: current.id,
          upstream: currentUpstream.id,
          durationMs: Date.now() - requestStartedAt,
          ...usage,
        };
        if (current.id !== model.id) fields.failoverFrom = model.id;
        log.info("anthropic done", fields);
      }
      sendJson(res, upstreamRes.status === 200 ? 200 : upstreamRes.status, message);
      return;
    }

    res.writeHead(upstreamRes.status, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      ...CORS_HEADERS,
    });
    const encoder = new AnthropicStreamEncoder();
    let streamUsage: TokenUsage | null = null;
    let streamClosed = false;
    if (upstreamRes.body) {
      for await (const frame of readSseStream(
        upstreamRes.body as unknown as import("node:stream/web").ReadableStream,
      )) {
        if (frame.data === "[DONE]") {
          streamClosed = true;
          for (const ev of encoder.close()) res.write(ev);
          break;
        }
        let json: any;
        try { json = JSON.parse(frame.data); } catch { continue; }
        const usage = extractUsage(json);
        if (usage) streamUsage = usage;
        for (const ev of encoder.push(json, current.id)) res.write(ev);
      }
    }
    // some upstreams end the SSE body without a [DONE] frame; the client
    // still needs the closing anthropic events or it waits forever
    if (!streamClosed) {
      for (const ev of encoder.close()) res.write(ev);
    }
    if (streamUsage) {
      const fields: Record<string, unknown> = {
        model: current.id,
        upstream: currentUpstream.id,
        durationMs: Date.now() - requestStartedAt,
        ...streamUsage,
      };
      if (current.id !== model.id) fields.failoverFrom = model.id;
      log.info("anthropic done", fields);
    }
    res.end();
    return;
  }

  // fell out of the loop: every candidate rejected with 429/5xx
  const final = transientError ?? { status: 502, errorMsg: "no upstream candidates left" };
  log.warn("upstream rejected", {
    model: model.id,
    upstream: currentUpstream.id,
    status: final.status || 502,
    durationMs: Date.now() - requestStartedAt,
    attempts: tried.size,
    error: final.errorMsg.slice(0, 100),
  });
  sendAnthropicError(res, final.status || 502, final.errorMsg);
}

function sendAnthropicError(
  res: http.ServerResponse,
  status: number,
  message: string,
): void {
  sendJson(res, status, {
    type: "error",
    error: { type: "invalid_request_error", message },
  });
}

export function createServer(opts: ServerOptions): http.Server {
  const { catalog, rateLimiter, port, log, startedAt } = opts;

  return http.createServer((req, res) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    const method = req.method ?? "";

    if (!rateLimiter.check(ip)) {
      log.warn("rate limit exceeded", { ip });
      sendJson(res, 429, { error: { message: "rate limit exceeded" } });
      return;
    }

    if (!ALLOWED_METHODS.has(method)) {
      sendJson(res, 405, { error: { message: "method not allowed" } });
      return;
    }

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }

    const rawUrl = req.url ?? "/";
    if (!validatePath(rawUrl)) {
      sendJson(res, 403, { error: { message: "forbidden" } });
      return;
    }
    const cleanUrl = rawUrl.split("?")[0] ?? "/";
    const url = cleanUrl.replace(/\/+$/, "");

    if (method === "GET" && (url === "/v1/models" || url === "/models")) {
      sendJson(res, 200, {
        object: "list",
        data: catalog.models.map((m) => ({
          id: m.id,
          object: "model",
          created: 0,
          owned_by: m.source,
          source: m.source,
          name: m.name,
          context_window: m.contextWindow,
          context_length: m.contextWindow,
          max_tokens: m.maxTokens,
          maxTokens: m.maxTokens,
          reasoning: m.reasoning,
        })),
      });
      return;
    }

    if (url === "/healthz") {
      const relay = loadRelayState();
      sendJson(res, 200, {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        modelCount: catalog.models.length,
        relay: { enabled: relay.enabled, url: relay.url },
      });
      return;
    }

    if (url === "/bansos/status") {
      const relay = loadRelayState();
      const payload: StatusPayload = {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        port,
        modelCount: catalog.models.length,
        models: catalog.models.map((m) => m.id),
        relay: { enabled: relay.enabled, url: relay.url },
      };
      sendJson(res, 200, payload);
      return;
    }

    if (method === "POST" && url === "/bansos/refresh") {
      void catalog
        .refresh()
        .then((report) => {
          sendJson(res, 200, {
            refreshed: true,
            modelCount: catalog.models.length,
            alive: report.alive,
          });
        })
        .catch((err: unknown) => {
          sendJson(res, 500, { error: { message: `refresh failed: ${String(err)}` } });
        });
      return;
    }


    if (method === "GET" && (url === "/bansos/adapters")) {
      sendJson(
        res,
        200,
        ADAPTERS.map((a) => ({
          id: a.id,
          name: a.name,
          wire: a.wire,
          configPaths: a.configPaths,
        })),
      );
      return;
    }

    if (method === "GET" && url === "/bansos/adapters/render") {
      const parsedUrl = new URL(rawUrl, "http://127.0.0.1");
      const id = parsedUrl.searchParams.get("id");
      const model = parsedUrl.searchParams.get("model") || undefined;
      if (!id) {
        sendJson(res, 400, { error: { message: "missing adapter id query parameter" } });
        return;
      }
      const adapter = findAdapter(id);
      if (!adapter) {
        sendJson(res, 404, { error: { message: `adapter "${id}" not found` } });
        return;
      }
      const defaultModel = model || (catalog.models[0]?.id ?? "tencent/hy3:free");
      const ctx = {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        defaultModel,
        models: catalog.models,
        specificModel: Boolean(model),
      };
      const config = adapter.render(ctx);
      sendJson(res, 200, {
        id: adapter.id,
        name: adapter.name,
        wire: adapter.wire,
        config,
      });
      return;
    }

    if (method === "GET" && url === "/bansos/relay") {
      const relay = loadRelayState();
      sendJson(res, 200, relay);
      return;
    }

    if (method === "POST" && url === "/bansos/relay/probe") {
      void readBody(req).then(async (bodyText) => {
        let targetUrl = "";
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText) as { url?: string };
            targetUrl = parsed.url || "";
          } catch {
            sendJson(res, 400, { error: { message: "invalid json body" } });
            return;
          }
        }
        if (!targetUrl) {
          const current = loadRelayState();
          targetUrl = current.url;
        }
        if (!targetUrl) {
          sendJson(res, 400, { error: { message: "no url specified or active" } });
          return;
        }

        const start = performance.now();
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 7000);
          const upstreamRes = await fetch(targetUrl, {
            method: "GET",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          const ms = Math.round(performance.now() - start);
          sendJson(res, 200, {
            ok: upstreamRes.status < 500,
            status: upstreamRes.status,
            latencyMs: ms,
          });
        } catch (err) {
          const ms = Math.round(performance.now() - start);
          sendJson(res, 200, {
            ok: false,
            latencyMs: ms,
            error: err instanceof Error ? err.message : "Unreachable",
          });
        }
      });
      return;
    }

    if (method === "POST" && url === "/bansos/relay") {
      void readBody(req).then((bodyText) => {
        let body: Record<string, unknown> = {};
        if (bodyText) {
          try {
            body = JSON.parse(bodyText) as Record<string, unknown>;
          } catch {
            sendJson(res, 400, { error: { message: "invalid json body" } });
            return;
          }
        }
        const updated = applyRelayMutation(loadRelayState(), body);
        saveRelayState(updated);
        sendJson(res, 200, updated);
      });
      return;
    }

    // Static Web UI Serving
    if (
      method === "GET" &&
      (url === "" ||
        url === "/index.html" ||
        cleanUrl.startsWith("/assets/") ||
        url === "/favicon.ico" ||
        url === "/favicon.svg" ||
        url === "/manifest.json" ||
        url === "/robots.txt")
    ) {
      serveStaticUi(res, cleanUrl);
      return;
    }

    if (method === "POST" && (url === "/v1/responses" || url === "/responses")) {
      void handleResponses(req, res, catalog, log);
      return;
    }

    if (method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
      void handleChat(req, res, catalog, log);
      return;
    }

    if (method === "POST" && (url === "/v1/messages" || url === "/messages")) {
      void handleAnthropic(req, res, catalog, log);
      return;
    }

    const notFound = () => {
      const accept = req.headers.accept ?? "";
      if (accept.includes("text/html")) {
        const notFoundHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 — Page Not Found | Bansos Router</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#111113;color:#f4f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1.5rem;box-sizing:border-box;">
  <div style="max-width:440px;width:100%;text-align:center;background:#16161a;border:1px solid #23232a;border-radius:1rem;padding:2.5rem 2rem;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
    <div style="display:inline-flex;align-items:center;justify-content:center;width:3rem;height:3rem;border-radius:0.75rem;background:#202028;border:1px solid #2c2c36;margin-bottom:1.25rem;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
    </div>
    <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#eab308;margin-bottom:0.25rem;">HTTP 404</div>
    <h1 style="font-size:1.25rem;font-weight:700;margin:0 0 0.5rem 0;color:#ffffff;letter-spacing:-0.025em;">Page Not Found</h1>
    <p style="font-size:0.875rem;color:#9393a0;margin:0 0 1.5rem 0;line-height:1.5;">The requested URL or resource does not exist on this Bansos Router daemon instance.</p>
    <a href="/" style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;background:#2b64e0;color:#ffffff;font-weight:600;font-size:0.8125rem;padding:0.625rem 1.25rem;border-radius:0.5rem;text-decoration:none;transition:background 0.15s ease;cursor:pointer;">
      <span>← Back to Dashboard</span>
    </a>
  </div>
</body>
</html>`;
        res.writeHead(404, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(notFoundHtml),
          ...CORS_HEADERS,
        });
        res.end(notFoundHtml);
        return;
      }
      sendJson(res, 404, { error: { message: "not found" } });
    };

    if (url === "/v1/responses" || url === "/responses") notFound();
    else notFound();
  });
}
