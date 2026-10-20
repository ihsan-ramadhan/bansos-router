import type { InternalContentBlock, InternalTurn, ParseResult } from "./internal";
import type { CallerTools, Translator } from "./tool-bridge";

// parse a /v1/responses body (input + instructions + tools + reasoning/max_output_tokens) into an InternalTurn
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

const SKIPPED_INPUT_ITEMS = new Set(["item_reference", "web_search_call", "file_search_call", "computer_call", "image_generation_call"]);

// convert a responses `input` (string or typed items) into chat messages; Error on unmappable shapes
function responsesInputToMessages(input: unknown, _previousId: unknown): InternalTurn["messages"] | Error {
  const items: unknown[] = typeof input === "string"
    ? [{ role: "user", content: input }]
    : Array.isArray(input)
      ? input
      : [input];

  const messages: InternalTurn["messages"] = [];
  // reasoning items precede the assistant output they belong to
  let thinking = "";
  const claimThinking = (m: InternalTurn["messages"][number]) => {
    if (!thinking) return;
    m.thinking = m.thinking ? `${m.thinking}\n${thinking}` : thinking;
    thinking = "";
  };

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return new Error("unsupported responses input item");
    }
    const it = item as Record<string, unknown>;
    if (typeof it.type === "string" && SKIPPED_INPUT_ITEMS.has(it.type)) continue;
    if (it.type === "reasoning") {
      const text = reasoningItemText(it);
      if (text) thinking = thinking ? `${thinking}\n${text}` : text;
      continue;
    }

    if (it.type === "function_call_output" || it.type === "custom_tool_call_output") {
      messages.push({
        role: "tool",
        toolCallId: typeof it.call_id === "string" ? it.call_id : "unknown",
        content: typeof it.output === "string" ? it.output : JSON.stringify(it.output ?? ""),
      });
      continue;
    }

    if (it.type === "function_call" || it.type === "custom_tool_call") {
      const call = {
        id: typeof it.call_id === "string" ? it.call_id : `call_${messages.length}`,
        name: typeof it.name === "string" ? it.name : "tool",
        arguments: typeof it.arguments === "string"
          ? it.arguments
          : typeof it.input === "string"
            ? it.input
            : JSON.stringify(it.arguments ?? {}),
      };
      const prev = messages[messages.length - 1];
      if (prev?.role === "assistant") prev.toolCalls = [...(prev.toolCalls ?? []), call];
      else messages.push({ role: "assistant", toolCalls: [call], content: "" });
      claimThinking(messages[messages.length - 1]!);
      continue;
    }

    const role = (it.role ?? (it.type === "message" ? it.role : undefined)) as string | undefined;
    if (typeof role !== "string") {
      return new Error("responses input item missing role");
    }
    const content = responsesContent(it.content);
    if (content instanceof Error) return content;

    if (role === "tool") {
      messages.push({
        role: "tool",
        toolCallId: typeof it.tool_call_id === "string" ? it.tool_call_id : "unknown",
        content: typeof content === "string" ? content : blocksToText(content),
      });
      continue;
    }

    const message = { role: role as InternalTurn["messages"][number]["role"], content };
    if (role === "assistant") claimThinking(message);
    messages.push(message);
  }

  return messages;
}

// full reasoning text when the client kept it, otherwise the summary we streamed
function reasoningItemText(item: Record<string, unknown>): string {
  const texts = (parts: unknown) =>
    Array.isArray(parts) ? parts.map((p) => (typeof p?.text === "string" ? p.text : "")).filter(Boolean) : [];
  const content = texts(item.content);
  return (content.length > 0 ? content : texts(item.summary)).join("\n");
}

function blocksToText(blocks: InternalContentBlock[]): string {
  return blocks.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n");
}

// responses content: a string or typed parts (input_text / input_image / output_text / text)
function responsesContent(content: unknown): string | InternalContentBlock[] | Error {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const blocks: InternalContentBlock[] = [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      if (typeof cc.text === "string") blocks.push({ type: "text", text: cc.text });
      else if (cc.type === "input_image" || typeof cc.image_url === "string") {
        const url = typeof cc.image_url === "string" ? cc.image_url : (cc.image_url as any)?.url;
        if (typeof url === "string" && url) blocks.push({ type: "image_url", url });
      }
    }
    if (blocks.every((b) => b.type === "text")) return blocks.map((b) => (b as { text: string }).text).join("\n");
    return blocks;
  }
  if (content === undefined || content === null) return "";
  return new Error("unsupported responses content shape");
}

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
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const text = direct.length > 0 || toolCalls.length > 0 ? direct : extractReasoningText(message);

  const output: any[] = [];
  if (text.length > 0 || toolCalls.length === 0) {
    output.push({
      type: "message",
      status: "completed",
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }
  for (const tc of toolCalls) {
    output.push({
      type: "function_call",
      status: "completed",
      id: `fc_${Math.random().toString(36).slice(2, 10)}`,
      call_id: tc?.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
      name: tc?.function?.name ?? "tool",
      arguments: tc?.function?.arguments ?? "{}",
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

export function renderResponsesEvent(type: string, data: unknown): string {
  const payload = { type, ...(data as Record<string, unknown>) };
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

interface StreamToolCall {
  itemId: string;
  callId: string;
  name: string;
  args: string;
  outputIndex: number;
  dropped: boolean;
  translate?: Translator;
  bridged?: boolean;
}

// stream translator: openai chat sse -> responses sse events (stateful)
export class ResponsesStreamEncoder {
  private started = false;
  private responseId = nextResponseId();
  private model = "";
  private nextIndex = 0;
  private message: { id: string; outputIndex: number; text: string; closed: boolean } | null = null;
  private reasoning: { id: string; outputIndex: number; text: string; closed: boolean } | null = null;
  private calls = new Map<number, StreamToolCall>();
  private items: Array<{ outputIndex: number; item: unknown }> = [];
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(private readonly callerTools?: CallerTools) {}

  open(model: string): string[] {
    if (this.started) return [];
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
    ];
  }

  push(chunk: any): string[] {
    const out: string[] = [];
    if (chunk?.usage) {
      if (typeof chunk.usage.prompt_tokens === "number") this.inputTokens = chunk.usage.prompt_tokens;
      if (typeof chunk.usage.completion_tokens === "number") this.outputTokens = chunk.usage.completion_tokens;
    }
    const choice = chunk?.choices?.[0];
    if (!choice) return out;
    const delta = choice.delta ?? {};

    const reasoningDelta =
      (typeof delta.reasoning === "string" ? delta.reasoning : "") +
      (typeof delta.reasoning_content === "string" ? delta.reasoning_content : "");
    if (reasoningDelta.length > 0) {
      if (this.reasoning?.closed) this.reasoning = null;
      if (!this.reasoning) {
        this.reasoning = { id: `rs_${randomId()}`, outputIndex: this.nextIndex++, text: "", closed: false };
        out.push(renderResponsesEvent("response.output_item.added", {
          output_index: this.reasoning.outputIndex,
          item: { id: this.reasoning.id, type: "reasoning", summary: [] },
        }));
        out.push(renderResponsesEvent("response.reasoning_summary_part.added", {
          item_id: this.reasoning.id,
          output_index: this.reasoning.outputIndex,
          summary_index: 0,
          part: { type: "summary_text", text: "" },
        }));
      }
      this.reasoning.text += reasoningDelta;
      out.push(renderResponsesEvent("response.reasoning_summary_text.delta", {
        item_id: this.reasoning.id,
        output_index: this.reasoning.outputIndex,
        summary_index: 0,
        delta: reasoningDelta,
      }));
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      out.push(...this.closeReasoning());
      out.push(...this.appendText(delta.content));
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc?.index === "number" ? tc.index : 0;
        let call = this.calls.get(index);
        if (!call) {
          const name = tc?.function?.name;
          if (typeof name !== "string") continue;
          out.push(...this.closeReasoning(), ...this.closeMessage());
          const dropped = this.callerTools !== undefined && !this.callerTools.has(name);
          call = {
            itemId: `fc_${randomId()}`,
            callId: typeof tc.id === "string" && tc.id ? tc.id : `call_${randomId()}`,
            name,
            args: "",
            outputIndex: dropped ? -1 : this.nextIndex++,
            dropped,
            translate: dropped ? this.callerTools?.bridge?.(name) ?? undefined : undefined,
          };
          this.calls.set(index, call);
          if (!dropped) {
            out.push(renderResponsesEvent("response.output_item.added", {
              output_index: call.outputIndex,
              item: { id: call.itemId, type: "function_call", status: "in_progress", call_id: call.callId, name, arguments: "" },
            }));
          }
        }
        const argDelta = tc?.function?.arguments;
        if (typeof argDelta === "string" && argDelta.length > 0) {
          call.args += argDelta;
          if (!call.dropped) {
            out.push(renderResponsesEvent("response.function_call_arguments.delta", {
              item_id: call.itemId,
              output_index: call.outputIndex,
              delta: argDelta,
            }));
          }
        }
      }
    }
    return out;
  }

  close(): string[] {
    const out: string[] = this.open(this.model || "unknown");
    for (const call of this.calls.values()) {
      const translated = call.translate?.(call.args, call.callId);
      if (!translated) continue;
      call.name = translated.name;
      call.args = translated.arguments;
      call.dropped = false;
      call.bridged = true;
    }
    const visibleCalls = [...this.calls.values()].filter((c) => !c.dropped);
    if (!this.message && visibleCalls.length === 0) {
      const fold = this.calls.size === 0 ? this.reasoning?.text ?? "" : "";
      out.push(...this.closeReasoning());
      out.push(...this.appendText(fold));
    }
    out.push(...this.closeReasoning(), ...this.closeMessage());
    for (const call of visibleCalls) {
      if (!call.bridged) continue;
      call.outputIndex = this.nextIndex++;
      out.push(renderResponsesEvent("response.output_item.added", {
        output_index: call.outputIndex,
        item: { id: call.itemId, type: "function_call", status: "in_progress", call_id: call.callId, name: call.name, arguments: "" },
      }));
      out.push(renderResponsesEvent("response.function_call_arguments.delta", {
        item_id: call.itemId,
        output_index: call.outputIndex,
        delta: call.args,
      }));
    }
    for (const call of visibleCalls) {
      const args = call.args || "{}";
      out.push(renderResponsesEvent("response.function_call_arguments.done", {
        item_id: call.itemId,
        output_index: call.outputIndex,
        arguments: args,
      }));
      const item = { id: call.itemId, type: "function_call", status: "completed", call_id: call.callId, name: call.name, arguments: args };
      this.items.push({ outputIndex: call.outputIndex, item });
      out.push(renderResponsesEvent("response.output_item.done", { output_index: call.outputIndex, item }));
    }
    out.push(renderResponsesEvent("response.completed", {
      response: {
        id: this.responseId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: this.model,
        output: [...this.items].sort((a, b) => a.outputIndex - b.outputIndex).map((i) => i.item),
        parallel_tool_calls: true,
        usage: {
          input_tokens: this.inputTokens,
          output_tokens: this.outputTokens,
          total_tokens: this.inputTokens + this.outputTokens,
        },
      },
    }));
    return out;
  }

  fail(message: string): string[] {
    return [
      ...this.open(this.model || "unknown"),
      renderResponsesEvent("response.failed", {
        response: {
          id: this.responseId,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          status: "failed",
          model: this.model,
          output: [],
          error: { code: "server_error", message },
          usage: null,
        },
      }),
    ];
  }

  private appendText(text: string): string[] {
    const out: string[] = [];
    if (this.message?.closed) {
      if (text.length === 0) return out;
      this.message = null;
    }
    if (!this.message) {
      this.message = { id: `msg_${randomId()}`, outputIndex: this.nextIndex++, text: "", closed: false };
      out.push(renderResponsesEvent("response.output_item.added", {
        output_index: this.message.outputIndex,
        item: { id: this.message.id, type: "message", status: "in_progress", role: "assistant", content: [] },
      }));
      out.push(renderResponsesEvent("response.content_part.added", {
        output_index: this.message.outputIndex,
        content_index: 0,
        item_id: this.message.id,
        part: { type: "output_text", text: "", annotations: [] },
      }));
    }
    if (text.length > 0) {
      this.message.text += text;
      out.push(renderResponsesEvent("response.output_text.delta", {
        item_id: this.message.id,
        output_index: this.message.outputIndex,
        content_index: 0,
        delta: text,
      }));
    }
    return out;
  }

  private closeMessage(): string[] {
    const m = this.message;
    if (!m || m.closed) return [];
    m.closed = true;
    const part = { type: "output_text", text: m.text, annotations: [] };
    const item = { id: m.id, type: "message", status: "completed", role: "assistant", content: [part] };
    this.items.push({ outputIndex: m.outputIndex, item });
    return [
      renderResponsesEvent("response.output_text.done", { item_id: m.id, output_index: m.outputIndex, content_index: 0, text: m.text }),
      renderResponsesEvent("response.content_part.done", { item_id: m.id, output_index: m.outputIndex, content_index: 0, part }),
      renderResponsesEvent("response.output_item.done", { output_index: m.outputIndex, item }),
    ];
  }

  private closeReasoning(): string[] {
    const r = this.reasoning;
    if (!r || r.closed) return [];
    r.closed = true;
    const part = { type: "summary_text", text: r.text };
    const item = { id: r.id, type: "reasoning", summary: [part] };
    this.items.push({ outputIndex: r.outputIndex, item });
    return [
      renderResponsesEvent("response.reasoning_summary_text.done", { item_id: r.id, output_index: r.outputIndex, summary_index: 0, text: r.text }),
      renderResponsesEvent("response.reasoning_summary_part.done", { item_id: r.id, output_index: r.outputIndex, summary_index: 0, part }),
      renderResponsesEvent("response.output_item.done", { output_index: r.outputIndex, item }),
    ];
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 12);
}
