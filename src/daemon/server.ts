import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import type { Logger } from "../logger";
import {
  DEFAULT_SECURITY_CONFIG,
  isCrossProviderFailoverAllowed,
  isRelayAllowed,
  isLoopbackBind,
  isSensitiveNetworkHost,
  isStrictSecurity,
  isUpstreamAllowed,
  type SecurityConfig,
} from "../security/policy";
import { redactRequestBody, scanRequestBody, type SecretType } from "../security/secret-guard";
import { ActivityStore, type ActivityKind } from "./activity";
import type { ModelDef, Upstream } from "../upstreams/types";
import { pickSmartDefaultModel } from "../upstreams/types";
import { parseChatTurn, sanitizeChatBody } from "../protocols/openai-chat";
import { parseResponsesTurn, renderResponse, extractReasoningText, ResponsesStreamEncoder } from "../protocols/responses";
import { chatToResponsesBody, toChatResponse } from "../protocols/responses-upstream";
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
import { harnessStatuses } from "../cli/doctor";
import { ADMIN_PATHS, handleAdmin, type AdminOptions } from "./admin";
import { createSseFrameSplitter, readSseStream } from "../protocols/stream";
import { callerToolsFromBody, type CallerTools, type Translator } from "../protocols/tool-bridge";
import type { RuntimeCatalog } from "./catalog";
import type { RateLimiter } from "./rate-limit";

let activity: ActivityStore = new ActivityStore();

export interface StatusPayload {
  status: "ok";
  uptimeSeconds: number;
  port: number;
  modelCount: number;
  models: string[];
  providers: Array<{ id: string; models: number; allowed: boolean }>;
  relay?: { enabled: boolean; url: string };
  security?: {
    mode: "normal" | "strict";
    dlp: "redact" | "block";
    allowedUpstreams: string[];
    allowCrossProviderFailover: boolean;
  };
}

function providerCounts(
  catalog: RuntimeCatalog,
  security: SecurityConfig,
): Array<{ id: string; models: number; allowed: boolean }> {
  const counts = new Map<string, number>();
  for (const m of catalog.models) counts.set(m.source, (counts.get(m.source) ?? 0) + 1);
  return [...counts].map(([id, models]) => ({ id, models, allowed: isUpstreamAllowed(security, id) }));
}

export interface ServerOptions {
  catalog: RuntimeCatalog;
  rateLimiter: RateLimiter;
  port: number;
  log: Logger;
  startedAt: number;
  security?: SecurityConfig;
  activity?: ActivityStore;
  admin?: Partial<Omit<AdminOptions, "security" | "catalog" | "port">>;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS"]);

export { pickSmartDefaultModel };

// reject a malformed relay url here, not at use time (it is fetched on every egress)
function applyRelayMutation(
  initialState: RelayState,
  body: Record<string, unknown>,
): RelayState | { error: string } {
  let current: RelayState = {
    ...initialState,
    relays: initialState.relays.map((r) => ({ ...r })),
  };

  if (Array.isArray(body.relays)) {
    const relays: RelayState["relays"] = [];
    for (const entry of body.relays) {
      if (!entry || typeof entry !== "object") return { error: "relays must be an array of objects" };
      const rec = entry as Record<string, unknown>;
      if (!isValidRelayUrl(rec.url)) return { error: "invalid relay url in relays list" };
      relays.push({
        url: (rec.url as string).trim(),
        ...(typeof rec.label === "string" && rec.label.trim() ? { label: rec.label.trim().slice(0, 100) } : {}),
        ...(typeof rec.addedAt === "string" ? { addedAt: rec.addedAt } : {}),
      });
    }
    current.relays = relays;
  }

  if (typeof body.enabled === "boolean") {
    current.enabled = body.enabled;
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 100) || undefined : undefined;
  const hasUrl = typeof body.url === "string" && body.url.trim() !== "";
  if (hasUrl && !isValidRelayUrl(body.url)) return { error: "invalid relay url" };

  if (hasUrl) {
    const cleanUrl = (body.url as string).trim();
    if (!body.action) {
      current.url = cleanUrl;
      if (!current.relays.some((r: import("../relay/egress").KnownRelay) => r.url === cleanUrl)) {
        current = addRelay(current, cleanUrl, label);
      }
    } else if (body.action === "add") {
      current = addRelay(current, cleanUrl, label);
    } else if (body.action === "remove") {
      current = removeRelay(current, cleanUrl);
    }
  }
  return current;
}
const STATIC_ROOT_FILES = new Set([
  "/",
  "/index.html",
  "/favicon.ico",
  "/favicon.svg",
  "/favicon.png",
  "/apple-touch-icon.png",
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
  "/bansos/usage",
  "/bansos/usage/",
  "/bansos/events",
  "/bansos/events/",
  ...[...ADMIN_PATHS].flatMap((p) => [p, `${p}/`]),
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

// fallback models to try after the primary is rejected; total attempts = 1 + this
const MAX_FAILOVER_RETRIES = 2;

// only loopback origins get CORS; a wildcard would let any website drive the daemon
function corsHeadersForOrigin(originHeader: string | undefined): Record<string, string> {
  if (!originHeader) return {};
  let hostname = "";
  try {
    hostname = new URL(originHeader).hostname;
  } catch {
    return {};
  }
  if (!isLoopbackBind(hostname)) return {};
  return {
    "access-control-allow-origin": originHeader,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

interface CorsAwareResponse extends http.ServerResponse {
  // per-request CORS headers, attached at the top of the connection handler
  bansosCors?: Record<string, string>;
}

function corsFor(res: http.ServerResponse): Record<string, string> {
  return (res as CorsAwareResponse).bansosCors ?? {};
}

// DNS-rebinding guard: loopback clients must present a loopback Host
let ownAddresses: Set<string> | null = null;

function isOwnAddress(hostname: string): boolean {
  if (ownAddresses === null) {
    const set = new Set<string>();
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const iface of ifaces ?? []) set.add(iface.address.toLowerCase());
    }
    ownAddresses = set;
  }
  return ownAddresses.has(hostname.toLowerCase());
}

function isHostTrusted(req: http.IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (isLoopbackBind(hostname)) return true;
  const peer = req.socket.remoteAddress ?? "";
  if (isLoopbackBind(peer)) return isOwnAddress(hostname);
  return true;
}

// CSRF guard: browsers always send Origin cross-site; native clients send none
function isOriginTrusted(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (isLoopbackBind(url.hostname)) return true;
  return url.host === req.headers.host;
}

// validates a user-supplied relay URL before it is stored or probed
function isValidRelayUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return u.hostname.length > 0;
}

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
    // resolution can throw on odd import.meta.url shapes; cwd still works
  }
  const candidate3 = path.resolve(process.cwd(), "dist/ui");
  if (fs.existsSync(candidate3)) return candidate3;
  return path.resolve(process.cwd(), "dist/ui");
}

// the SPA is self-contained, so a strict CSP costs nothing here (C4)
function securityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
}

function serveStaticUi(res: http.ServerResponse, reqPath: string): void {
  const uiDir = getUiDistDir();
  let relativePath = reqPath.replace(/^\/+/, "");
  if (!relativePath || relativePath === "index.html") {
    relativePath = "index.html";
  }

  const filePath = path.join(uiDir, relativePath);

  // path traversal guard: a crafted url must not escape uiDir
  if (!filePath.startsWith(uiDir)) {
    sendJson(res, 403, { error: { message: "forbidden" } });
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      ...securityHeaders(),
      ...corsFor(res),
    });
    const rs = fs.createReadStream(filePath);
    rs.on("error", () => res.destroy());
    rs.pipe(res);
    return;
  }

  if (relativePath.startsWith("assets/")) {
    sendJson(res, 404, { error: { message: "asset not found" } });
    return;
  }

  // any other path is an SPA route, so hand back index.html
  const indexPath = path.join(uiDir, "index.html");
  if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      ...securityHeaders(),
      ...corsFor(res),
    });
    const rs = fs.createReadStream(indexPath);
    rs.on("error", () => res.destroy());
    rs.pipe(res);
    return;
  }

  // no build present: say so instead of 404ing, the daemon API still works
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
    ...securityHeaders(),
    ...corsFor(res),
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

// limit relay targets to the active/saved relay or a public address, to block SSRF probing
function probeTargetAllowed(
  targetUrl: string,
  state: RelayState,
): { allowed: boolean; reason?: string } {
  const trimmed = targetUrl.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { allowed: false, reason: "invalid url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { allowed: false, reason: "only http(s) targets can be probed" };
  }
  if (u.username || u.password) {
    return { allowed: false, reason: "url must not contain credentials" };
  }
  if (state.url === trimmed || state.relays.some((r) => r.url === trimmed)) {
    return { allowed: true };
  }
  if (isSensitiveNetworkHost(u.hostname)) {
    return { allowed: false, reason: "target resolves to a loopback/private network address" };
  }
  return { allowed: true };
}

// guard the daemon from an unhandled rejection/stream error: send 502 if unwritten, else close
function runRequest(
  promise: Promise<void>,
  res: http.ServerResponse,
  log: Logger,
  label: string,
): void {
  res.on("error", () => {
    // client vanished mid-response; nothing left to send
  });
  promise.catch(() => {
    log.warn(`${label}: request failed`, { status: 502 });
    try {
      if (res.headersSent) res.end();
      else {
        sendJson(res, 502, {
          error: { message: "upstream request failed", type: "upstream_error", status: 502 },
        });
      }
    } catch {
      // connection already gone
    }
  });
}

function clientDisconnectSignal(res: http.ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
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
    ...corsFor(res),
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

// openai chat in -> resolve model -> forward raw body -> stream the reply back unchanged

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

// find the first complete `"usage": {...}` in a tail of SSE bytes, tolerating nested braces
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

// fold reasoning into content when a model streams reasoning_content but no content (C5)
type ChatFoldState = { sawContent: boolean; sawToolCalls: boolean; reasoning: string; envelope: Record<string, unknown> };

function inspectChatFrame(frame: string, state: ChatFoldState): { finished: boolean } {
  let finished = false;
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    if (json?.id || json?.model) {
      state.envelope = { id: json.id, model: json.model, created: json.created };
    }
    const choice = json?.choices?.[0];
    if (choice?.finish_reason) finished = true;
    const delta = choice?.delta;
    if (!delta || typeof delta !== "object") continue;
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) state.sawToolCalls = true;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      state.sawContent = true;
      continue;
    }
    const reasoning =
      typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0
        ? delta.reasoning_content
        : typeof delta.reasoning === "string" && delta.reasoning.length > 0
          ? delta.reasoning
          : "";
    state.reasoning += reasoning;
  }
  return { finished };
}

function foldedContentFrame(state: { reasoning: string; envelope: Record<string, unknown> }): string {
  return `data: ${JSON.stringify({
    id: state.envelope.id ?? "chatcmpl-reasoning-fold",
    object: "chat.completion.chunk",
    created: state.envelope.created ?? Math.floor(Date.now() / 1000),
    model: state.envelope.model ?? "",
    choices: [{ index: 0, delta: { role: "assistant", content: state.reasoning }, finish_reason: null }],
  })}\n\n`;
}

// stream transform: reassemble split SSE frames, fold reasoning-only deltas, pass the rest
export function declaredToolNames(body: unknown): Set<string> {
  const tools = (body as Record<string, unknown> | null)?.tools;
  return new Set(
    (Array.isArray(tools) ? tools : [])
      .map((t: any) => t?.function?.name ?? t?.name)
      .filter((n: unknown): n is string => typeof n === "string"),
  );
}

export function filterInjectedToolCallsTransform(callerTools: CallerTools): Transform {
  const verdict = new Map<number, boolean>();
  const bridged = new Map<number, { id?: string; args: string; translate: Translator }>();
  let forwarded = false;
  let envelope: Record<string, unknown> = {};

  const flushBridged = (): string => {
    const toolCalls: unknown[] = [];
    for (const [index, b] of bridged) {
      const id = b.id ?? `call_${index}_${Date.now().toString(36)}`;
      const call = b.translate(b.args, id);
      if (call) toolCalls.push({ index, id, type: "function", function: call });
    }
    bridged.clear();
    if (toolCalls.length === 0) return "";
    forwarded = true;
    return `data: ${JSON.stringify({
      id: envelope.id ?? "chatcmpl-bridge",
      object: "chat.completion.chunk",
      created: envelope.created ?? Math.floor(Date.now() / 1000),
      model: envelope.model ?? "",
      choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
    })}\n\n`;
  };

  const rewriteFrame = (frame: string): string => {
    const line = frame.trimStart();
    if (!line.startsWith("data:")) return frame;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return flushBridged() + frame;
    if (payload === "") return frame;

    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      return frame;
    }
    if (json?.id || json?.model) envelope = { id: json.id, model: json.model, created: json.created };

    const choice = json?.choices?.[0];
    if (!choice) return frame;
    let changed = false;

    const calls = choice.delta?.tool_calls;
    if (Array.isArray(calls)) {
      const kept = calls.filter((tc: any) => {
        const name = tc?.function?.name;
        if (typeof name === "string" && !verdict.has(tc.index)) {
          const own = callerTools.has(name);
          verdict.set(tc.index, own);
          const translate = own ? null : callerTools.bridge?.(name);
          if (translate) bridged.set(tc.index, { id: tc.id, args: "", translate });
        }
        const b = bridged.get(tc.index);
        if (b && typeof tc?.function?.arguments === "string") b.args += tc.function.arguments;
        return verdict.get(tc.index) ?? true;
      });
      if (kept.length > 0) forwarded = true;
      if (kept.length !== calls.length) {
        changed = true;
        if (kept.length === 0) delete choice.delta.tool_calls;
        else choice.delta.tool_calls = kept;
      }
    }

    let prefix = "";
    if (choice.finish_reason) {
      prefix = flushBridged();
      if (prefix && choice.finish_reason !== "tool_calls") {
        choice.finish_reason = "tool_calls";
        changed = true;
      }
    }
    if (choice.finish_reason === "tool_calls" && !forwarded) {
      choice.finish_reason = "stop";
      changed = true;
    }

    return prefix + (changed ? `data: ${JSON.stringify(json)}\n\n` : frame);
  };

  const splitter = createSseFrameSplitter();
  return new Transform({
    transform(chunk, _enc, cb) {
      for (const frame of splitter.push(chunk)) this.push(Buffer.from(rewriteFrame(frame), "utf8"));
      cb();
    },
    flush(cb) {
      const rest = splitter.rest();
      if (rest) this.push(Buffer.from(rewriteFrame(rest), "utf8"));
      const tail = flushBridged();
      if (tail) this.push(Buffer.from(tail, "utf8"));
      cb();
    },
  });
}

export function reasoningToContentTransform(): Transform {
  const splitter = createSseFrameSplitter();
  let folded = false;
  const state: ChatFoldState = { sawContent: false, sawToolCalls: false, reasoning: "", envelope: {} };

  // promote reasoning to the answer only when nothing else came, and before the finish frame
  const foldIfNothingElse = (push: (frame: string) => void) => {
    if (folded) return;
    folded = true;
    if (!state.sawContent && !state.sawToolCalls && state.reasoning.length > 0) push(foldedContentFrame(state));
  };

  return new Transform({
    transform(chunk, _enc, cb) {
      for (const frame of splitter.push(chunk)) {
        if (/^data: ?\[DONE\]/.test(frame) || inspectChatFrame(frame, state).finished) {
          foldIfNothingElse((f) => this.push(Buffer.from(f, "utf8")));
        }
        this.push(Buffer.from(frame, "utf8"));
      }
      cb();
    },
    flush(cb) {
      const rest = splitter.rest();
      if (rest) {
        if (inspectChatFrame(rest, state).finished) foldIfNothingElse((f) => this.push(Buffer.from(f, "utf8")));
        this.push(Buffer.from(rest, "utf8"));
      }
      foldIfNothingElse((f) => this.push(Buffer.from(f, "utf8")));
      cb();
    },
  });
}

// pass-through that logs the usage object once and emits a terminating [DONE] if missing
export function logUsageTransform(
  model: string,
  upstream: string,
  log: Logger,
  startedAt: number,
  requestedModel?: string,
  activity?: ActivityStore,
  kind: ActivityKind = "chat",
): Transform {
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
            activity?.record({
              kind,
              model,
              requestedModel: requestedModel ?? model,
              upstream,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              durationMs: Date.now() - startedAt,
              status: "ok",
              ...(requestedModel && requestedModel !== model ? { failoverFrom: requestedModel } : {}),
            });
          }
        }
      }
      cb(null, chunk);
    },
    flush(cb) {
      // strict SSE parsers hang without a terminating [DONE]
      if (!tail.includes("[DONE]")) {
        this.push("\ndata: [DONE]\n\n");
      }
      cb();
    },
  });
}

export function parseRetryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : undefined;
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  const delta = at - now;
  return delta > 0 ? delta : undefined;
}

export function retryAfterFromMessage(message: string): number | undefined {
  const m = /retry (?:after|in) (\d+(?:\.\d+)?) ?(s|sec|seconds?|ms|m|min|minutes?)\b/i.exec(message);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit === "ms") return n;
  if (unit.startsWith("m")) return n * 60_000;
  return n * 1000;
}

export const FAILOVER_CONTEXT_TOLERANCE = 0.9;

export function pickFailover(
  catalog: RuntimeCatalog,
  origin: ModelDef,
  attempts: ReadonlySet<string> = new Set(),
  allowed: (candidate: ModelDef) => boolean = () => true,
): ModelDef | undefined {
  let best: ModelDef | undefined;
  let bestShort = true;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const candidate of catalog.models) {
    if (candidate.id === origin.id) continue;
    if (attempts.has(candidate.id)) continue;
    if (!allowed(candidate)) continue;
    if (candidate.source === origin.source) continue;
    if (candidate.reasoning !== origin.reasoning) continue;
    if (candidate.compat.supportsDeveloperRole !== origin.compat.supportsDeveloperRole) continue;
    if (candidate.compat.supportsReasoningEffort !== origin.compat.supportsReasoningEffort) continue;
    if (candidate.contextWindow < origin.contextWindow * FAILOVER_CONTEXT_TOLERANCE) continue;

    const short = candidate.contextWindow < origin.contextWindow;
    const gap = Math.abs(candidate.contextWindow - origin.contextWindow);
    if (best !== undefined) {
      if (short !== bestShort) {
        if (short) continue;
      } else if (gap !== bestGap) {
        if (gap > bestGap) continue;
      } else if (candidate.maxTokens <= best.maxTokens) continue;
    }
    best = candidate;
    bestShort = short;
    bestGap = gap;
  }
  return best;
}
// shared by chat and responses: resolve, sanitize, then retry on 429/5xx against another upstream
type ForwardResult = { response: Response; model: ModelDef; upstream: Upstream };
type ForwardError = {
  status: number;
  message: string;
  type?: "upstream_error" | "security_policy_error";
  secretTypes?: SecretType[];
};

function isExternalUpstream(upstream: Upstream): boolean {
  try {
    const url = new URL(upstream.chatUrl);
    return !isLoopbackBind(url.hostname);
  } catch {
    // unparseable destinations count as external so strict DLP still applies
    return true;
  }
}

function selectFailover(
  catalog: RuntimeCatalog,
  current: ModelDef,
  currentUpstream: Upstream,
  tried: ReadonlySet<string>,
  security: SecurityConfig,
  failoverAllowed: boolean,
  status: number,
  requestStartedAt: number,
  log: Logger,
  upstreamError?: string,
): ModelDef | undefined {
  if (!failoverAllowed) {
    log.warn("upstream rejected", {
      model: current.id,
      upstream: currentUpstream.id,
      status,
      durationMs: Date.now() - requestStartedAt,
      failoverBlocked: true,
      ...(upstreamError ? { upstreamError } : {}),
    });
    return undefined;
  }

  return pickFailover(catalog, current, tried, (candidate) => {
    if (catalog.isCoolingDown(candidate.id)) return false;
    const candidateUpstream = catalog.upstreamBySource(candidate.source);
    return Boolean(candidateUpstream && isUpstreamAllowed(security, candidateUpstream.id));
  });
}

interface ToolCallAcc {
  id?: string;
  name?: string;
  args: string;
}

export function sseErrorMessage(json: any): string | null {
  if (!json || typeof json !== "object") return null;
  if (json.error) return json.error.message ?? String(json.error);
  if (json.choices) return null;
  if (json.type === "error") return json.message ?? json.error?.message ?? "upstream stream error";
  if (json.type === "response.failed") return json.response?.error?.message ?? "upstream response failed";
  return null;
}

const SSE_PEEK_LIMIT = 65536;
const SSE_PEEK_TIMEOUT_MS = 5000;

export const VISION_UNSUPPORTED_RE = /(does not|doesn't|not) support(s)? (vision|image|images|image input|multimodal)|image input is not supported/i;

export function hasImageInput(body: unknown): boolean {
  const messages = (body as Record<string, unknown> | null)?.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((m: any) =>
    Array.isArray(m?.content) &&
    m.content.some((p: any) => p?.type === "image_url" || p?.type === "input_image" || p?.type === "image"),
  );
}

export const TOOLS_UNSUPPORTED_RE = /(does not|doesn't|not) support(s)? (tools|tool use|tool calls|function calling)|support tool use/i;

// some upstreams answer 200 and then put the failure in the first SSE frame
export async function peekStreamError(
  res: Response,
  timeoutMs = SSE_PEEK_TIMEOUT_MS,
): Promise<{ response: Response; error: string | null }> {
  if (!res.body || (res.headers.get("content-type") ?? "").includes("json")) return { response: res, error: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + timeoutMs;
  let text = "";
  let scanned = 0;
  let error: string | null = null;
  let done = false;
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  scan: while (text.length < SSE_PEEK_LIMIT) {
    pending = reader.read();
    const wait = deadline - Date.now();
    if (wait <= 0) break;
    let timer: NodeJS.Timeout | undefined;
    const next = await Promise.race([
      pending,
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), wait))),
    ]);
    clearTimeout(timer);
    if (next === null) break;
    pending = null;
    if (next.done) {
      done = true;
      break;
    }
    chunks.push(next.value);
    text = (text + decoder.decode(next.value, { stream: true })).replace(/\r\n/g, "\n");
    let end = text.indexOf("\n\n", scanned);
    while (end !== -1) {
      const lines = text.slice(scanned, end).split("\n");
      scanned = end + 2;
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") break scan;
        let json: any;
        try {
          json = JSON.parse(payload);
        } catch {
          break scan;
        }
        error = sseErrorMessage(json);
        if (error || json?.choices || typeof json?.type === "string") break scan;
      }
      end = text.indexOf("\n\n", scanned);
    }
  }

  if (error) {
    void reader.cancel().catch(() => {});
    return { response: res, error };
  }
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      if (done) controller.close();
    },
    async pull(controller) {
      const next = await (pending ?? reader.read());
      pending = null;
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return {
    response: new Response(replay, { status: res.status, statusText: res.statusText, headers: res.headers }),
    error: null,
  };
}

export async function streamToChatResponse(
  upstreamRes: Response,
  modelId: string,
  callerTools?: CallerTools,
): Promise<Response> {
  if (!upstreamRes.body) return upstreamRes;
  const text = await upstreamRes.text();
  if (text.trim().startsWith("{")) {
    return new Response(text, {
      status: upstreamRes.status,
      headers: { "content-type": "application/json" },
    });
  }
  const lines = text.split("\n");
  let content = "";
  let reasoning = "";
  let finishReason = "stop";
  let usage: unknown = undefined;
  let streamError: string | null = null;
  const calls = new Map<number, ToolCallAcc>();
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    try {
      const json = JSON.parse(data);
      streamError ??= sseErrorMessage(json);
      const choice = json.choices?.[0];
      if (choice?.delta?.content) content += choice.delta.content;
      if (choice?.delta?.reasoning) reasoning += choice.delta.reasoning;
      else if (choice?.delta?.reasoning_content) reasoning += choice.delta.reasoning_content;
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const slot = calls.get(tc.index) ?? { args: "" };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        calls.set(tc.index, slot);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (json.usage) usage = json.usage;
    } catch {
      // ignore frame parse errors
    }
  }

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, c]) => {
      if (c.name === undefined) return [];
      const id = c.id ?? `call_${Math.random().toString(36).slice(2, 12)}`;
      const fn = !callerTools || callerTools.has(c.name)
        ? { name: c.name, arguments: c.args || "{}" }
        : callerTools.bridge?.(c.name)?.(c.args, id);
      if (!fn) return [];
      return [{ id, type: "function" as const, function: fn }];
    });
  if (toolCalls.length === 0 && finishReason === "tool_calls") finishReason = "stop";
  if (streamError && !content && !reasoning && toolCalls.length === 0) {
    return new Response(JSON.stringify({ error: { message: streamError, type: "upstream_error" } }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            ...(reasoning ? { [toolCalls.length < calls.size ? "reasoning_content" : "reasoning"]: reasoning } : {}),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: finishReason,
        },
      ],
      ...(usage ? { usage } : {}),
    }),
    {
      status: upstreamRes.status,
      headers: { "content-type": "application/json" },
    },
  );
}

async function runChatForward(
  req: http.IncomingMessage,
  catalog: RuntimeCatalog,
  log: Logger,
  security: SecurityConfig,
  parsedModel: string,
  sanitizedBody: Record<string, unknown>,
  signal: AbortSignal,
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
  const failoverAllowed =
    req.headers["x-bansos-no-failover"] !== "1" &&
    isCrossProviderFailoverAllowed(security);
  const tried = new Set<string>([model.id]);
  let current: ModelDef = model;
  let currentUpstream = upstream;
  let transientError: ForwardError | null = null;
  const callerTools = callerToolsFromBody(sanitizedBody);
  const needsTools = declaredToolNames(sanitizedBody).size > 0;
  const needsVision = hasImageInput(sanitizedBody);
  const incapable = (m: ModelDef) =>
    (needsTools && m.supportsTools === false) || (needsVision && !m.input.includes("image"));
  for (const m of catalog.models) if (incapable(m)) tried.add(m.id);

  if (failoverAllowed && incapable(current)) {
    transientError = {
      status: 400,
      message: `model ${current.id} does not support ${needsVision && !current.input.includes("image") ? "image input" : "tool calls"}`,
    };
    const capable = selectFailover(
      catalog, current, currentUpstream, tried, security, true,
      400, requestStartedAt, log, transientError.message,
    );
    if (capable) {
      tried.add(capable.id);
      current = capable;
      currentUpstream = catalog.upstreamBySource(current.source)!;
    }
  }

  // model is in 429 cooldown: start on a fallback instead of re-learning it
  if (failoverAllowed && catalog.isCoolingDown(current.id) && current.id === model.id) {
    transientError = { status: 429, message: "model is cooling down after a recent rate limit" };
    const warm = selectFailover(
      catalog, current, currentUpstream, tried, security, true,
      429, requestStartedAt, log,
    );
    if (warm) {
      tried.add(warm.id);
      current = warm;
      currentUpstream = catalog.upstreamBySource(current.source)!;
    }
  }

  for (let attempt = 0; attempt <= MAX_FAILOVER_RETRIES; attempt++) {
    if (current.id !== model.id || attempt > 0) {
      log.warn("upstream rejected - fallback used", {
        from: model.id,
        to: current.id,
        // name the originally requested model's upstream (currentUpstream has moved to the fallback)
        fromUpstream: upstream.id,
        status: transientError?.status,
        durationMs: Date.now() - requestStartedAt,
        attempt,
      });
    }

    if (!isUpstreamAllowed(security, currentUpstream.id)) {
      log.warn("upstream blocked by strict security policy", {
        model: current.id,
        upstream: currentUpstream.id,
        status: 403,
        durationMs: Date.now() - requestStartedAt,
        failoverBlocked: true,
      });
      return {
        status: 403,
        type: "security_policy_error",
        message: security.allowedUpstreams.length === 0
          ? "strict security mode blocks external LLM requests until security.allowedUpstreams explicitly permits a provider"
          : `upstream "${currentUpstream.id}" is not allowed by strict security policy`,
      };
    }

    const headers = new Headers({
      "content-type": "application/json",
      ...currentUpstream.requestHeaders(current),
    });
    // responses-wire model: body/reply translated at the edges so the pipeline only sees chat
    const responsesWire = current.wireApi === "responses" && !!currentUpstream.responsesUrl;
    const outboundUrl = responsesWire ? currentUpstream.responsesUrl! : currentUpstream.chatUrl;
    const transformedBody = currentUpstream.transformRequestBody
      ? currentUpstream.transformRequestBody({ ...sanitizedBody, model: current.id }, current)
      : { ...sanitizedBody, model: current.id };
    let outboundBody = JSON.stringify(
      responsesWire
        ? chatToResponsesBody(transformedBody, current.id)
        : transformedBody,
    );

    if (isStrictSecurity(security) && isExternalUpstream(currentUpstream)) {
      const secretScan = scanRequestBody(outboundBody);
      const redaction = secretScan.blocked && security.dlp === "redact" ? redactRequestBody(outboundBody) : null;
      if (redaction) {
        outboundBody = redaction.body;
        log.warn("secret guard redacted request", {
          model: current.id,
          upstream: currentUpstream.id,
          dlpRedacted: true,
          redactions: redaction.count,
          secretTypes: redaction.secretTypes,
        });
      } else if (secretScan.blocked) {
        log.warn("request blocked by secret guard", {
          model: current.id,
          upstream: currentUpstream.id,
          status: 422,
          durationMs: Date.now() - requestStartedAt,
          dlpBlocked: true,
          secretTypes: secretScan.secretTypes,
        });
        return {
          status: 422,
          type: "security_policy_error",
          message: "request blocked by secret guard",
          secretTypes: secretScan.secretTypes,
        };
      }
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await relayFetch(relay, outboundUrl, {
        method: "POST",
        headers,
        body: outboundBody,
        duplex: "half",
        signal,
      }, isRelayAllowed(security));
    } catch {
      transientError = { status: 502, message: "upstream request failed" };
      const next = selectFailover(
        catalog, current, currentUpstream, tried, security, failoverAllowed,
        502, requestStartedAt, log,
      );
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    if (upstreamRes.status >= 400) {
      const text = await upstreamRes.text();
      let errorMsg = `upstream returned HTTP ${upstreamRes.status}`;
      try {
        const json = JSON.parse(text);
        if (!isStrictSecurity(security)) {
          errorMsg = json?.error?.message ?? json?.message ?? text.slice(0, 256) ?? errorMsg;
        }
      } catch {
        if (!isStrictSecurity(security) && text) errorMsg = text.slice(0, 256);
      }

      const refused = upstreamRes.status === 401 || upstreamRes.status === 403;
      const capabilityRejected =
        (needsTools && TOOLS_UNSUPPORTED_RE.test(errorMsg)) || (needsVision && VISION_UNSUPPORTED_RE.test(errorMsg));
      const transient = refused || capabilityRejected || upstreamRes.status === 429 || upstreamRes.status >= 500;
      if (!transient) {
        log.warn("upstream rejected", {
          model: current.id,
          upstream: currentUpstream.id,
          status: upstreamRes.status,
          durationMs: Date.now() - requestStartedAt,
          upstreamError: errorMsg,
        });
        return { status: upstreamRes.status, message: errorMsg };
      }

      if (refused) {
        catalog.markRefused(current.id);
      } else if (upstreamRes.status === 429) {
        catalog.markRateLimited(
          current.id,
          parseRetryAfterMs(upstreamRes.headers.get("retry-after")) ?? retryAfterFromMessage(errorMsg),
        );
      }

      transientError = { status: upstreamRes.status, message: errorMsg };
      const next = selectFailover(
        catalog, current, currentUpstream, tried, security, failoverAllowed,
        upstreamRes.status, requestStartedAt, log, errorMsg,
      );
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    // some upstreams answer 200 with an error envelope and no choices; fail over on it
    if ((upstreamRes.headers.get("content-type") ?? "").includes("json")) {
      let envelopeError: string | null = null;
      try {
        const peek = (await upstreamRes.clone().json()) as { error?: { message?: string }; choices?: unknown };
        if (peek && typeof peek === "object" && peek.error && !peek.choices) {
          envelopeError = peek.error.message ?? "upstream returned an error under HTTP 200";
        }
      } catch {
        // unreadable or not json: let the normal path handle the original
      }
      if (envelopeError) {
        transientError = { status: 502, message: envelopeError };
        const next = selectFailover(
          catalog, current, currentUpstream, tried, security, failoverAllowed,
          502, requestStartedAt, log, envelopeError,
        );
        if (!next) break;
        tried.add(next.id);
        current = next;
        currentUpstream = catalog.upstreamBySource(current.source)!;
        continue;
      }
    }

    const peeked = await peekStreamError(upstreamRes);
    if (peeked.error) {
      transientError = { status: 502, message: peeked.error };
      const next = selectFailover(
        catalog, current, currentUpstream, tried, security, failoverAllowed,
        502, requestStartedAt, log, peeked.error,
      );
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }
    upstreamRes = peeked.response;

    const forcedStream = !sanitizedBody.stream && transformedBody.stream === true;
    let finalResponse = upstreamRes;
    if (responsesWire) {
      finalResponse = await toChatResponse(
        upstreamRes,
        current.id,
        sanitizedBody.stream === true || forcedStream,
      );
      if (forcedStream) {
        finalResponse = await streamToChatResponse(finalResponse, current.id, callerTools);
      }
    } else if (forcedStream) {
      finalResponse = await streamToChatResponse(upstreamRes, current.id, callerTools);
    }

    return {
      response: finalResponse,
      model: current,
      upstream: currentUpstream,
    };
  }

  return transientError ?? { status: 502, message: "no upstream candidates left" };
}

async function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
  security: SecurityConfig,
  signal: AbortSignal,
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

  const callerTools = callerToolsFromBody(body);
  const result = await runChatForward(
    req,
    catalog,
    log,
    security,
    parsed.value.model,
    sanitizedBody,
    signal,
  );
  if ("status" in result) {
    activity.record({
      kind: "chat",
      model: parsed.value.model,
      requestedModel: parsed.value.model,
      upstream: catalog.resolve(parsed.value.model)?.source ?? "unknown",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - requestStartedAt,
      status: "error",
      statusCode: result.status,
    });
    sendJson(res, result.status, {
      error: { message: result.message, type: result.type ?? "upstream_error", status: result.status },
      ...(result.secretTypes ? { secret_types: result.secretTypes } : {}),
    });
    return;
  }

  const { response: upstreamRes, model: current, upstream: currentUpstream } = result;
  const model = catalog.resolve(parsed.value.model) ?? current;
  log.info("chat -> upstream", {
    model: current.id,
    upstream: currentUpstream.id,
    stream: parsed.value.stream,
  });

  const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
  res.writeHead(upstreamRes.status, { "content-type": contentType, ...corsFor(res) });

  if (!parsed.value.stream) {
    // non-stream: buffer once to read usage, then forward the exact bytes
    const text = await upstreamRes.text();
    let outText = text;
    try {
      const json = JSON.parse(text);
      const msg = json?.choices?.[0]?.message;
      if (msg && typeof msg.content === "string" && msg.content.length === 0 && !msg.tool_calls?.length) {
        const rt = extractReasoningText(msg);
        if (rt) {
          // patch only the message object, passing every other field through byte-exact
          json.choices[0].message = { ...msg, content: rt };
          outText = JSON.stringify(json);
        }
      }
      const usage = extractUsage(json);
      if (usage) {
        const fields: Record<string, unknown> = {
          model: current.id,
          upstream: currentUpstream.id,
          durationMs: Date.now() - requestStartedAt,
          ...usage,
        };
        if (current.id !== model.id) fields.failoverFrom = model.id;
        log.info("chat done", fields);
        activity.record({
          kind: "chat",
          model: current.id,
          requestedModel: model.id,
          upstream: currentUpstream.id,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          durationMs: Date.now() - requestStartedAt,
          status: "ok",
          ...(current.id !== model.id ? { failoverFrom: model.id } : {}),
        });
      }
    } catch {
      // usage is informational only; the plain response still goes out
    }
    res.end(outText);
    return;
  }

  if (upstreamRes.body) {
    const src = Readable.fromWeb(
      upstreamRes.body as import("node:stream/web").ReadableStream,
    );
    const usageTx = logUsageTransform(current.id, currentUpstream.id, log, requestStartedAt, model.id, activity, "chat");
    // a mid-stream upstream failure ends the client response, not the daemon; client abort releases the upstream
    const failStream = () => {
      if (signal.aborted) {
        try {
          res.destroy();
        } catch {
          // response already gone
        }
        return;
      }
      log.warn("upstream stream interrupted", {
        model: current.id,
        upstream: currentUpstream.id,
        status: 502,
      });
      try {
        res.destroy();
      } catch {
        // response already gone
      }
    };
    src.on("error", failStream);
    usageTx.on("error", failStream);
    res.on("error", () => src.destroy());
    signal.addEventListener("abort", () => src.destroy());
    const filterTx = filterInjectedToolCallsTransform(callerTools);
    filterTx.on("error", failStream);
    src.pipe(reasoningToContentTransform()).pipe(filterTx).pipe(usageTx).pipe(res);
  } else {
    res.end();
  }
}

// codex responses wire -> openai chat -> forward -> translate back to responses output
async function handleResponses(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
  security: SecurityConfig,
  signal: AbortSignal,
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

  const chatMessages: any[] = [];
  if (parsed.value.system) {
    chatMessages.push({ role: "system", content: parsed.value.system });
  }
  for (const m of parsed.value.messages) {
    chatMessages.push({
      role: m.role,
      content: typeof m.content === "string"
        ? m.content
        : m.content.map((b) => (b.type === "text" ? b : { type: "image_url", image_url: { url: b.url } })),
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

  const callerTools = callerToolsFromBody(sanitizedBody);
  const result = await runChatForward(
    req,
    catalog,
    log,
    security,
    parsed.value.model,
    sanitizedBody,
    signal,
  );
  if ("status" in result) {
    activity.record({
      kind: "responses",
      model: parsed.value.model,
      requestedModel: parsed.value.model,
      upstream: catalog.resolve(parsed.value.model)?.source ?? "unknown",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - requestStartedAt,
      status: "error",
      statusCode: result.status,
    });
    sendJson(res, result.status, {
      error: { message: result.message, type: result.type ?? "upstream_error", status: result.status },
      ...(result.secretTypes ? { secret_types: result.secretTypes } : {}),
    });
    return;
  }

  const { response: upstreamRes, model: current, upstream: currentUpstream } = result;
  const resolved = catalog.resolve(parsed.value.model) ?? current;
  log.info("responses -> upstream", {
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
      activity.record({
        kind: "responses",
        model: current.id,
        requestedModel: resolved.id,
        upstream: currentUpstream.id,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - requestStartedAt,
        status: "ok",
        ...(current.id !== resolved.id ? { failoverFrom: resolved.id } : {}),
      });
    }
    const out = renderResponse(json, current.id);
    res.writeHead(upstreamRes.status, { "content-type": "application/json", ...corsFor(res) });
    res.end(JSON.stringify(out));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    ...corsFor(res),
  });
  const encoder = new ResponsesStreamEncoder(callerTools);
  let first = true;
  let failed = false;
  let streamUsage: TokenUsage | null = null;
  try {
    if (upstreamRes.body) {
      for await (const frame of readSseStream(
        upstreamRes.body as unknown as import("node:stream/web").ReadableStream,
      )) {
        if (signal.aborted) break;
        if (frame.data === "[DONE]") continue;
        let json: any;
        try { json = JSON.parse(frame.data); } catch { continue; }
        if (first) {
          first = false;
          for (const ev of encoder.open(current.id)) res.write(ev);
        }
        const streamError = sseErrorMessage(json);
        if (streamError) {
          failed = true;
          log.warn("upstream stream error", { model: current.id, upstream: currentUpstream.id, upstreamError: streamError });
          for (const ev of encoder.fail(streamError)) res.write(ev);
          break;
        }
        const usage = extractUsage(json);
        if (usage) streamUsage = usage;
        for (const ev of encoder.push(json)) res.write(ev);
      }
    }
  } catch {
    if (!signal.aborted) {
      log.warn("upstream stream interrupted", {
        model: current.id,
        upstream: currentUpstream.id,
        status: 502,
      });
    }
  }
  if (!failed) for (const ev of encoder.close()) res.write(ev);
  if (streamUsage) {
    const fields: Record<string, unknown> = {
      model: current.id,
      upstream: currentUpstream.id,
      durationMs: Date.now() - requestStartedAt,
      ...streamUsage,
    };
    if (current.id !== resolved.id) fields.failoverFrom = resolved.id;
    log.info("responses done", fields);
    activity.record({
      kind: "responses",
      model: current.id,
      requestedModel: resolved.id,
      upstream: currentUpstream.id,
      inputTokens: streamUsage.inputTokens,
      outputTokens: streamUsage.outputTokens,
      durationMs: Date.now() - requestStartedAt,
      status: "ok",
      ...(current.id !== resolved.id ? { failoverFrom: resolved.id } : {}),
    });
  }
  res.end();
}

// anthropic messages in -> translate to openai chat -> forward -> translate back
async function handleAnthropic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
  security: SecurityConfig,
  signal: AbortSignal,
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
  // cap max_tokens to the model's limit so a stale client value never reaches the upstream
  if (typeof chatBody.max_tokens === "number" && chatBody.max_tokens > model.maxTokens) {
    chatBody.max_tokens = model.maxTokens;
  }

  const callerTools = callerToolsFromBody(chatBody);
  const result = await runChatForward(
    req,
    catalog,
    log,
    security,
    parsed.value.model,
    chatBody,
    signal,
  );
  if ("status" in result) {
    activity.record({
      kind: "anthropic",
      model: parsed.value.model,
      requestedModel: parsed.value.model,
      upstream: model?.source ?? "unknown",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - requestStartedAt,
      status: "error",
      statusCode: result.status,
    });
    sendAnthropicError(res, result.status, result.message, result.secretTypes);
    return;
  }

  const { response: upstreamRes, model: current, upstream: currentUpstream } = result;
  log.info("anthropic -> upstream", {
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
      activity.record({
        kind: "anthropic",
        model: current.id,
        requestedModel: model.id,
        upstream: currentUpstream.id,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - requestStartedAt,
        status: "ok",
        ...(current.id !== model.id ? { failoverFrom: model.id } : {}),
      });
    }
    sendJson(res, upstreamRes.status === 200 ? 200 : upstreamRes.status, message);
    return;
  }

  res.writeHead(upstreamRes.status, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    ...corsFor(res),
  });
  const encoder = new AnthropicStreamEncoder(callerTools);
  let streamUsage: TokenUsage | null = null;
  let streamClosed = false;
  try {
    if (upstreamRes.body) {
      for await (const frame of readSseStream(
        upstreamRes.body as unknown as import("node:stream/web").ReadableStream,
      )) {
        if (signal.aborted) break;
        if (frame.data === "[DONE]") {
          streamClosed = true;
          for (const ev of encoder.close()) res.write(ev);
          break;
        }
        let json: any;
        try { json = JSON.parse(frame.data); } catch { continue; }
        const streamError = sseErrorMessage(json);
        if (streamError) {
          streamClosed = true;
          log.warn("upstream stream error", { model: current.id, upstream: currentUpstream.id, upstreamError: streamError });
          for (const ev of encoder.fail(streamError)) res.write(ev);
          break;
        }
        const usage = extractUsage(json);
        if (usage) streamUsage = usage;
        for (const ev of encoder.push(json, current.id)) res.write(ev);
      }
    }
  } catch {
    if (!signal.aborted) {
      log.warn("upstream stream interrupted", {
        model: current.id,
        upstream: currentUpstream.id,
        status: 502,
      });
    }
  }
  // always emit the closing Anthropic events (some upstreams omit [DONE]) so clients do not hang
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
    activity.record({
      kind: "anthropic",
      model: current.id,
      requestedModel: model.id,
      upstream: currentUpstream.id,
      inputTokens: streamUsage.inputTokens,
      outputTokens: streamUsage.outputTokens,
      durationMs: Date.now() - requestStartedAt,
      status: "ok",
      ...(current.id !== model.id ? { failoverFrom: model.id } : {}),
    });
  }
  res.end();
}

export function anthropicErrorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 413) return "request_too_large";
  if (status === 429) return "rate_limit_error";
  if (status === 503 || status === 529) return "overloaded_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

function sendAnthropicError(
  res: http.ServerResponse,
  status: number,
  message: string,
  secretTypes?: SecretType[],
): void {
  sendJson(res, status, {
    type: "error",
    error: { type: anthropicErrorType(status), message },
    ...(secretTypes ? { secret_types: secretTypes } : {}),
  });
}

export function createServer(opts: ServerOptions): http.Server {
  const { catalog, rateLimiter, port, log, startedAt } = opts;
  const security = opts.security ?? DEFAULT_SECURITY_CONFIG;
  activity = opts.activity ?? new ActivityStore();
  const adminOptions: AdminOptions = {
    bind: "127.0.0.1",
    refreshIntervalMs: 0,
    ...opts.admin,
    security,
    catalog,
    port,
  };

  const visibleRelayState = () => {
    const relay = loadRelayState();
    return {
      ...relay,
      enabled: isRelayAllowed(security) ? relay.enabled : false,
      securityMode: security.mode,
      locked: !isRelayAllowed(security),
    };
  };

  return http.createServer((req, res) => {
    (res as CorsAwareResponse).bansosCors = corsHeadersForOrigin(req.headers.origin);
    const clientSignal = clientDisconnectSignal(res);
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
      const cors = corsFor(res);
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // DNS-rebinding guard: loopback clients must present a loopback (or own-interface) Host
    if (!isHostTrusted(req)) {
      sendJson(res, 403, { error: { message: "forbidden host" } });
      return;
    }

    if (method === "POST" && !isOriginTrusted(req)) {
      sendJson(res, 403, { error: { message: "cross-site request blocked" } });
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
      const listAll = new URL(rawUrl, "http://127.0.0.1").searchParams.has("all");
      sendJson(res, 200, {
        object: "list",
        data: (listAll ? catalog.models : catalog.servableModels).map((m) => ({
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
          input: m.input,
          supports_tools: m.supportsTools !== false,
        })),
      });
      return;
    }

    if (url === "/healthz") {
      const relay = visibleRelayState();
      sendJson(res, 200, {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        modelCount: catalog.servableModels.length,
        relay: { enabled: relay.enabled, url: relay.url },
        security: {
          mode: security.mode,
          allowedUpstreams: security.allowedUpstreams,
          allowCrossProviderFailover: security.allowCrossProviderFailover,
        },
      });
      return;
    }

    if (url === "/bansos/status") {
      const relay = visibleRelayState();
      const payload: StatusPayload = {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        port,
        modelCount: catalog.servableModels.length,
        models: catalog.servableModels.map((m) => m.id),
        providers: providerCounts(catalog, security),
        relay: { enabled: relay.enabled, url: relay.url },
        security: {
          mode: security.mode,
          dlp: security.dlp,
          allowedUpstreams: security.allowedUpstreams,
          allowCrossProviderFailover: security.allowCrossProviderFailover,
        },
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
            modelCount: catalog.servableModels.length,
            alive: report.alive,
          });
        })
        .catch((err: unknown) => {
          sendJson(res, 500, { error: { message: `refresh failed: ${String(err)}` } });
        });
      return;
    }


    if (method === "GET" && (url === "/bansos/adapters")) {
      const statuses = harnessStatuses();
      sendJson(
        res,
        200,
        ADAPTERS.map((a) => ({
          id: a.id,
          name: a.name,
          wire: a.wire,
          configPaths: a.configPaths,
          status: statuses.find((h) => h.id === a.id)?.status ?? "missing",
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
      const defaultModel = model || pickSmartDefaultModel(catalog.servableModels);
      const reqHost = req.headers.host || `127.0.0.1:${port}`;
      const isHttps = Boolean((req.socket as import("node:tls").TLSSocket)?.encrypted);
      const proto = isHttps ? "https" : "http";
      const baseUrl = `${proto}://${reqHost}/v1`;
      const ctx = {
        baseUrl,
        defaultModel,
        models: catalog.servableModels,
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
      sendJson(res, 200, visibleRelayState());
      return;
    }

    if (method === "GET" && url === "/bansos/usage") {
      const parsedUrl = new URL(rawUrl, "http://127.0.0.1");
      const window = (parsedUrl.searchParams.get("window") || "all") as import("./activity").TimeWindow;
      sendJson(res, 200, activity.getUsage(window));
      return;
    }

    if (method === "GET" && url === "/bansos/events") {
      const parsedUrl = new URL(rawUrl, "http://127.0.0.1");
      const limitParam = Number(parsedUrl.searchParams.get("limit"));
      const window = (parsedUrl.searchParams.get("window") || "all") as import("./activity").TimeWindow;
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
      sendJson(res, 200, { events: activity.getEvents(limit, window) });
      return;
    }

    if (method === "POST" && url === "/bansos/relay/probe") {
      if (!isRelayAllowed(security)) {
        sendJson(res, 403, {
          error: { message: "relay is disabled by strict security mode", type: "security_policy_error" },
        });
        return;
      }
      void runRequest(
        readBody(req).then(async (bodyText) => {
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

          const policy = probeTargetAllowed(targetUrl, loadRelayState());
          if (!policy.allowed) {
            sendJson(res, 403, {
              error: { message: `relay probe blocked: ${policy.reason}`, type: "security_policy_error" },
            });
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
        }),
        res,
        log,
        "relay probe",
      );
      return;
    }

    if (ADMIN_PATHS.has(url)) {
      void runRequest(
        handleAdmin(req, method, url, rawUrl, () => readBody(req, 1024 * 1024), adminOptions).then((result) => {
          sendJson(res, result.status, result.body);
          const after = result.after;
          if (after) {
            if (res.writableFinished) setImmediate(after);
            else res.once("finish", after);
          }
        }),
        res,
        log,
        "settings",
      );
      return;
    }

    if (method === "POST" && url === "/bansos/relay") {
      if (!isRelayAllowed(security)) {
        sendJson(res, 403, {
          error: { message: "relay mutation is disabled by strict security mode", type: "security_policy_error" },
        });
        return;
      }
      void runRequest(
        readBody(req).then((bodyText) => {
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
          if ("error" in updated) {
            sendJson(res, 400, { error: { message: updated.error } });
            return;
          }
          saveRelayState(updated);
          sendJson(res, 200, updated);
        }),
        res,
        log,
        "relay mutation",
      );
      return;
    }

    if (
      method === "GET" &&
      (url === "" ||
        url === "/index.html" ||
        cleanUrl.startsWith("/assets/") ||
        url === "/favicon.ico" ||
        url === "/favicon.svg" ||
        url === "/favicon.png" ||
        url === "/apple-touch-icon.png" ||
        url === "/manifest.json" ||
        url === "/robots.txt")
    ) {
      serveStaticUi(res, cleanUrl);
      return;
    }

    if (method === "POST" && (url === "/v1/responses" || url === "/responses")) {
      runRequest(handleResponses(req, res, catalog, log, security, clientSignal), res, log, "responses");
      return;
    }

    if (method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
      runRequest(handleChat(req, res, catalog, log, security, clientSignal), res, log, "chat");
      return;
    }

    if (method === "POST" && (url === "/v1/messages" || url === "/messages")) {
      runRequest(handleAnthropic(req, res, catalog, log, security, clientSignal), res, log, "anthropic");
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
  <title>Page Not Found | Bansos Router</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#111113;color:#f4f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1.5rem;box-sizing:border-box;">
  <div style="max-width:400px;width:100%;text-align:center;background:#16161a;border:1px solid #23232a;border-radius:1rem;padding:2.5rem 2rem;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
    <div style="display:inline-flex;align-items:center;justify-content:center;width:3rem;height:3rem;border-radius:0.75rem;background:#202028;border:1px solid #2c2c36;margin-bottom:1.25rem;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
    </div>
    <h1 style="font-size:1.125rem;font-weight:700;margin:0 0 0.5rem 0;color:#ffffff;letter-spacing:-0.025em;">Page Not Found</h1>
    <p style="font-size:0.8125rem;color:#9393a0;margin:0 0 1.5rem 0;line-height:1.5;">This page does not exist.</p>
    <a href="/" style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;background:#2b64e0;color:#ffffff;font-weight:600;font-size:0.8125rem;padding:0.625rem 1.25rem;border-radius:0.5rem;text-decoration:none;transition:background 0.15s ease;cursor:pointer;">
      <span>← Back to Dashboard</span>
    </a>
  </div>
</body>
</html>`;
        res.writeHead(404, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(notFoundHtml),
          ...corsFor(res),
        });
        res.end(notFoundHtml);
        return;
      }
      sendJson(res, 404, { error: { message: "not found" } });
    };

    notFound();
  });
}
