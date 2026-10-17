import type { InternalTurn, ParseResult } from "./internal";

// strict upstreams (e.g. OVHcloud) 400 on these vLLM/OMP thinking controls
const UNSUPPORTED_TOP_LEVEL_FIELDS = ["preserve_thinking", "chat_template_kwargs", "enable_thinking"];

export function sanitizeChatBody(
  body: Record<string, unknown>,
  supportsDeveloperRole: boolean,
): Record<string, unknown> {
  let out = body;
  let modified = false;
  for (const field of UNSUPPORTED_TOP_LEVEL_FIELDS) {
    if (field in out) {
      if (out === body) out = { ...body };
      delete out[field];
      modified = true;
    }
  }

  if (!Array.isArray(out.messages)) {
    return modified ? out : body;
  }

  let messagesModified = false;
  const messages = out.messages.map((m) => {
    if (!m || typeof m !== "object") return m;
    const msg = m as Record<string, unknown>;
    const next: Record<string, unknown> = { ...msg };
    // upstreams reject reasoning echoes from prior turns on input
    if ("reasoning_content" in next) {
      delete next.reasoning_content;
      messagesModified = true;
    }
    if ("thought" in next) {
      delete next.thought;
      messagesModified = true;
    }
    if (!supportsDeveloperRole && msg.role === "developer") {
      next.role = "system";
      messagesModified = true;
    }
    return next;
  });

  if (messagesModified) {
    out = out === body ? { ...body, messages } : { ...out, messages };
    modified = true;
  }

  return modified ? out : body;
}

// parse a /v1/chat/completions body into an InternalTurn; forwarder passes the raw body through
export function parseChatTurn(body: unknown): ParseResult<InternalTurn> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const model = typeof b.model === "string" ? b.model : "";
  if (!model) return { ok: false, error: "missing required field: model" };
  if (!Array.isArray(b.messages)) {
    return { ok: false, error: "missing required field: messages" };
  }
  return {
    ok: true,
    value: {
      model,
      stream: b.stream === true,
      maxTokens: typeof b.max_tokens === "number" ? b.max_tokens : undefined,
      messages: [], // raw body forwarded as-is by the M0 forwarder
    },
  };
}
