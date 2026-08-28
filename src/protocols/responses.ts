import type { InternalTurn, ParseResult } from "./internal";

// parse an inbound /v1/responses body into an InternalTurn.
// The Responses API uses `input` (a string or array of typed items) plus
// `instructions` for the system prompt, `tools` for function tools, and
// `reasoning`/`max_output_tokens` for reasoning + length control.
export function parseResponsesTurn(body: unknown): ParseResult<InternalTurn> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const model = typeof b.model === "string" ? b.model : "";
  if (!model) return { ok: false, error: "missing required field: model" };
  if (!("input" in b)) return { ok: false, error: "missing required field: input" };

  const messages = responsesInputToMessages(b.input, b.previous_response_id);
  if (messages instanceof Error) {
    return { ok: false, error: messages.message };
  }

  let system: string | undefined;
  if (typeof b.instructions === "string" && b.instructions.trim()) {
    system = b.instructions;
  } else if (Array.isArray(b.instructions)) {
    const t = b.instructions
      .map((x) => (x && typeof x === "object" && "text" in x ? String((x as any).text) : ""))
      .join("");
    if (t.trim()) system = t;
  }

  return {
    ok: true,
    value: {
      model,
      system,
      messages,
      tools: responsesToolsToInternal(b.tools),
      maxTokens: typeof b.max_output_tokens === "number" ? b.max_output_tokens : undefined,
      reasoningEffort: responsesEffort(b.reasoning),
      stream: b.stream === true,
    },
  };
}

function responsesEffort(reasoning: unknown): InternalTurn["reasoningEffort"] {
  if (reasoning && typeof reasoning === "object" && "effort" in reasoning) {
    const e = (reasoning as any).effort;
    if (e === "low" || e === "medium" || e === "high") return e;
  }
  return undefined;
}

function responsesToolsToInternal(tools: unknown): InternalTurn["tools"] {
  if (!Array.isArray(tools)) return undefined;
  const out = tools
    .filter((t) => t && typeof t === "object" && (t as any).type === "function")
    .map((t: any) => ({
      name: String(t.name ?? ""),
      description: typeof t.description === "string" ? t.description : undefined,
      parameters: (t.parameters ?? {}) as Record<string, unknown>,
    }));
  return out.length ? out : undefined;
}

// convert a responses `input` into openai chat messages.
// accepts: a bare string, or an array of items:
//   { role: "user"|"system"|"assistant"|"developer", content: string | [{type, ...}] }
//   { type: "message", role, content: [...] }
//   function_call items -> assistant tool_calls
//   function_call_output items -> tool-role messages
// returns an Error if the shape can't be mapped (caller reports 400).
function responsesInputToMessages(input: unknown, _previousId: unknown): InternalTurn["messages"] | Error {
  const items: unknown[] = typeof input === "string"
    ? [{ role: "user", content: input }]
    : Array.isArray(input)
      ? input
      : [input];

  const messages: InternalTurn["messages"] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return new Error("unsupported responses input item");
    }
    const it = item as Record<string, unknown>;

    // function_call_output -> tool result
    if (it.type === "function_call_output") {
      messages.push({
        role: "tool",
        toolCallId: typeof it.call_id === "string" ? it.call_id : "unknown",
        content: typeof it.output === "string" ? it.output : JSON.stringify(it.output ?? ""),
      });
      continue;
    }

    // functional item: type "function_call" (assistant tool call)
    if (it.type === "function_call") {
      messages.push({
        role: "assistant",
        toolCalls: [{
          id: typeof it.call_id === "string" ? it.call_id : `call_${messages.length}`,
          name: typeof it.name === "string" ? it.name : "tool",
          arguments: typeof it.arguments === "string" ? it.arguments : JSON.stringify(it.arguments ?? {}),
        }],
        content: "",
      });
      continue;
    }

    const role = (it.role ?? (it.type === "message" ? it.role : undefined)) as string | undefined;
    if (typeof role !== "string") {
      return new Error("responses input item missing role");
    }
    const content = responsesContentToText(it.content);
    if (content instanceof Error) return content;

    if (role === "tool") {
      messages.push({
        role: "tool",
        toolCallId: typeof it.tool_call_id === "string" ? it.tool_call_id : "unknown",
        content,
      });
      continue;
    }

    messages.push({ role: role as InternalTurn["messages"][number]["role"], content });
  }

  return messages;
}

// responses content can be a string, or an array of typed parts:
//   [{type:"input_text", text}, {type:"input_image", image_url|image_base64},
//    {type:"output_text", text}, {type:"text", text}]
function responsesContentToText(content: unknown): string | Error {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      if (typeof cc.text === "string") parts.push(cc.text);
      else if (typeof cc.image_url === "string") parts.push(`[image: ${cc.image_url}]`);
      else if (cc.type === "input_image" && (cc.image_url || cc.image_base64)) {
        parts.push("[image]");
      }
    }
    return parts.join("\n");
  }
  if (content === undefined || content === null) return "";
  return new Error("unsupported responses content shape");
}

// response rendering (outbound, responses-shaped)

let respSeq = 0;
function nextResponseId(): string {
  respSeq += 1;
  return `resp_${Date.now().toString(36)}${respSeq.toString(36)}`;
}

export function extractReasoningText(message: any): string {
  if (!message || typeof message !== "object") return "";
  const parts: string[] = [];
  if (typeof message.reasoning === "string" && message.reasoning.length > 0) {
    parts.push(message.reasoning);
  }
  const details = message.reasoning_details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d.text === "string" && d.text.length > 0) parts.push(d.text);
    }
  }
  const raw = parts.join("\n\n").trim();
  if (!raw) return "";

  const markers = ["\nanswer:", "answer is", "\njawaban:", "the answer is", "answear is", "conclusion:", "\nfinal answer"];
  const lower = raw.toLowerCase();
  for (const m of markers) {
    const idx = lower.indexOf(m);
    if (idx !== -1) {
      const slice = raw.slice(idx + m.length).trim();
      if (slice) return slice;
    }
  }
  const paragraphs = raw.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean);
  const last = paragraphs[paragraphs.length - 1];
  return last ?? raw;
}

// build a non-streaming responses object from an openai chat completion.
export function renderResponse(chatJson: any, model: string): unknown {
  const choice = chatJson?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const direct = typeof message.content === "string" ? message.content : "";
  // fall back to reasoning text only when the direct content is empty
  const text = direct.length > 0 ? direct : extractReasoningText(message);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  const output: any[] = [];
  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      output.push({
        type: "function_call",
        status: "completed",
        id: tc?.id ?? `fc_${Math.random().toString(36).slice(2, 10)}`,
        call_id: tc?.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc?.function?.name ?? "tool",
        arguments: tc?.function?.arguments ?? "{}",
      });
    }
  } else {
    output.push({
      type: "message",
      status: "completed",
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }

  const usage = chatJson?.usage ?? {};
  return {
    id: nextResponseId(),
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "completed",
    output,
    parallel_tool_calls: true,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    },
  };
}

// build one responses sse event frame.
export function renderResponsesEvent(type: string, data: unknown): string {
  const payload = { type, ...(data as Record<string, unknown>) };
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

// stream translator: upstream openai chat sse -> responses sse events.
// stateful so we can emit output_item.added / content_part / output_text.delta.
export class ResponsesStreamEncoder {
  private started = false;
  private itemId = `msg_${Math.random().toString(36).slice(2, 12)}`;
  private responseId = nextResponseId();
  private model = "";
  private textStarted = false;
  private textDone = false;
  private textBuffer = "";
  private reasoningBuffer = "";
  private inputTokens = 0;
  private outputTokens = 0;

  open(model: string): string[] {
    this.model = model;
    this.started = true;
    const created = {
      response: {
        id: this.responseId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "in_progress",
        model,
        output: [],
        usage: null,
      },
    };
    return [
      renderResponsesEvent("response.created", created),
      renderResponsesEvent("response.in_progress", created),
      renderResponsesEvent("response.output_item.added", {
        output_index: 0,
        item: { id: this.itemId, type: "message", status: "in_progress", role: "assistant", content: [] },
      }),
      renderResponsesEvent("response.content_part.added", {
        output_index: 0,
        content_index: 0,
        item_id: this.itemId,
        part: { type: "output_text", text: "", annotations: [] },
      }),
    ];
  }

  push(chunk: any): string[] {
    const out: string[] = [];
    const choice = chunk?.choices?.[0];
    if (chunk?.usage) {
      if (typeof chunk.usage.prompt_tokens === "number") this.inputTokens = chunk.usage.prompt_tokens;
      if (typeof chunk.usage.completion_tokens === "number") this.outputTokens = chunk.usage.completion_tokens;
    }
    if (!choice) return out;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (!this.textStarted) {
        this.textStarted = true;
      }
      this.textBuffer += delta.content;
      out.push(renderResponsesEvent("response.output_text.delta", {
        item_id: this.itemId,
        output_index: 0,
        content_index: 0,
        delta: delta.content,
      }));
    }
    const reasoningDelta =
      (typeof delta.reasoning === "string" ? delta.reasoning : "") +
      (typeof delta.reasoning_content === "string" ? delta.reasoning_content : "");
    if (reasoningDelta.length > 0) {
      this.textStarted = true;
      this.reasoningBuffer += reasoningDelta;
      // surface the reasoning as text deltas too, so a streaming client that
      // only reads the output_text block still receives the answer.
      out.push(renderResponsesEvent("response.output_text.delta", {
        item_id: this.itemId,
        output_index: 0,
        content_index: 0,
        delta: reasoningDelta,
      }));
    }
    return out;
  }

  close(): string[] {
    const out: string[] = [];
    if (!this.started) {
      // upstream produced no chunks; still emit a well-formed completed event
      this.open(this.model || "unknown");
    }
    // prefer streamed content; fall back to accumulated reasoning text
    const finalText = this.textBuffer.length > 0 ? this.textBuffer : this.reasoningBuffer;
    if (this.textStarted && !this.textDone) {
      this.textDone = true;
      out.push(renderResponsesEvent("response.output_text.done", {
        item_id: this.itemId,
        output_index: 0,
        content_index: 0,
        text: finalText,
      }));
      out.push(renderResponsesEvent("response.content_part.done", {
        output_index: 0,
        content_index: 0,
        item_id: this.itemId,
        part: { type: "output_text", text: finalText, annotations: [] },
      }));
    }
    out.push(renderResponsesEvent("response.output_item.done", {
      output_index: 0,
      item: {
        id: this.itemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: finalText, annotations: [] }],
      },
    }));
    out.push(renderResponsesEvent("response.completed", {
      response: {
        id: this.responseId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: this.model,
        output: [
          {
            id: this.itemId,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: finalText, annotations: [] }],
          },
        ],
        usage: {
          input_tokens: this.inputTokens,
          output_tokens: this.outputTokens,
          total_tokens: this.inputTokens + this.outputTokens,
        },
      },
    }));
    return out;
  }
}
