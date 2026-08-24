import { sseEvent } from "./stream";
import type { ParseResult } from "./internal";

export interface AnthropicParsedRequest {
  model: string;
  stream: boolean;
  chatBody: Record<string, unknown>;
}

type Json = Record<string, any>;

// parse an inbound /v1/messages body and translate it into an openai chat
// body. model resolution (catalog) happens later in the daemon.
export function parseAnthropicRequest(body: unknown): ParseResult<AnthropicParsedRequest> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a json object" };
  }
  const b = body as Json;
  const model = typeof b.model === "string" ? b.model : "";
  if (!model) return { ok: false, error: "missing required field: model" };
  if (typeof b.max_tokens !== "number") {
    return { ok: false, error: "missing required field: max_tokens" };
  }
  if (!Array.isArray(b.messages)) {
    return { ok: false, error: "missing required field: messages" };
  }

  const system = normalizeText(b.system);
  const out: any[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of b.messages) {
    const conv = convertMessage(m);
    if (conv === null) return { ok: false, error: "unsupported message content" };
    out.push(...conv);
  }

  const chatBody: Record<string, unknown> = {
    model,
    messages: out,
    max_tokens: b.max_tokens,
    stream: b.stream === true,
  };
  if (typeof b.temperature === "number") chatBody.temperature = b.temperature;
  if (typeof b.top_p === "number") chatBody.top_p = b.top_p;
  if (Array.isArray(b.stop_sequences) && b.stop_sequences.length) {
    chatBody.stop = b.stop_sequences;
  }
  const tools = convertTools(b.tools);
  if (tools) chatBody.tools = tools;
  const tc = convertToolChoice(b.tool_choice);
  if (tc !== undefined) chatBody.tool_choice = tc;
  if (chatBody.stream) chatBody.stream_options = { include_usage: true };

  return { ok: true, value: { model, stream: chatBody.stream as boolean, chatBody } };
}

function normalizeText(x: unknown): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x === "string") return x.trim() || null;
  if (Array.isArray(x)) {
    const text = x
      .map((b) => {
        if (!b || typeof b !== "object") return "";
        if (b.type === "text" && typeof b.text === "string") return b.text;
        if (typeof b.text === "string") return b.text;
        return "";
      })
      .join("");
    return text.trim() || null;
  }
  return null;
}

function blocksToText(blocks: any[]): string {
  let t = "";
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") t += b.text;
    else if (typeof b.text === "string") t += b.text;
  }
  return t;
}

function imageToOpenAi(source: any): any | null {
  if (!source || typeof source !== "object") return null;
  if (source.type === "base64" && source.media_type && source.data) {
    return { type: "image_url", image_url: { url: `data:${source.media_type};base64,${source.data}` } };
  }
  if (source.type === "url" && source.url) {
    return { type: "image_url", image_url: { url: source.url } };
  }
  return null;
}

// returns one or more openai messages (tool_result splits into tool-role msgs)
function convertMessage(m: any): any[] | null {
  if (!m || typeof m !== "object") return null;
  const role = m.role;
  const content = m.content;

  if (role === "system" || role === "developer") {
    const text = typeof content === "string" ? content : (Array.isArray(content) ? blocksToText(content) : "");
    return [{ role: "system", content: text }];
  }

  if (role === "tool") {
    const text = typeof content === "string" ? content : (Array.isArray(content) ? blocksToText(content) : "");
    return [{ role: "tool", tool_call_id: m.tool_call_id ?? m.tool_use_id ?? "unknown", content: text }];
  }

  if (role === "assistant") {
    if (typeof content === "string") return [{ role: "assistant", content }];
    const blocks = Array.isArray(content) ? content : [];
    const text = blocksToText(blocks);
    const toolCalls: any[] = [];
    for (const b of blocks) {
      if (b && b.type === "tool_use") {
        toolCalls.push({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        });
      }
    }
    if (toolCalls.length > 0) {
      return [{ role: "assistant", content: text || null, tool_calls: toolCalls }];
    }
    return [{ role: "assistant", content: text || "" }];
  }

  if (role === "user") {
    const parts = typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content) ? content : [];

    const toolResults: any[] = [];
    for (const b of parts) {
      if (b && b.type === "tool_result") {
        toolResults.push({ role: "tool", tool_call_id: b.tool_use_id, content: toolResultContent(b.content) });
      }
    }
    const text = blocksToText(parts);
    const images = parts.map(imageToOpenAi).filter((x: any) => x !== null);

    const result: any[] = [];
    for (const tr of toolResults) result.push(tr); // tool msgs must precede the text turn
    if (text || images.length > 0) {
      const c: any[] = [];
      if (text) c.push({ type: "text", text });
      for (const img of images) c.push(img);
      result.push({ role: "user", content: c.length === 1 && c[0].type === "text" ? text : c });
    }
    if (result.length === 0 && toolResults.length === 0) {
      result.push({ role: "user", content: "" });
    }
    return result;
  }

  // Fallback for any other message structure
  const fallbackText = typeof content === "string" ? content : (Array.isArray(content) ? blocksToText(content) : "");
  return [{ role: "user", content: fallbackText }];
}

function toolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && b.type === "text" ? (b.text ?? "") : "")).join("");
  }
  return "";
}

function convertTools(tools: unknown): any[] | null {
  if (!Array.isArray(tools)) return null;
  return tools.map((t) => ({
    type: "function",
    function: { name: t?.name, description: t?.description ?? "", parameters: t?.input_schema ?? {} },
  }));
}

function convertToolChoice(tc: unknown): any {
  if (!tc || typeof tc !== "object") return undefined;
  const t = (tc as Json).type;
  if (t === "auto") return "auto";
  if (t === "any") return "required";
  if (t === "none") return "none";
  if (t === "tool") return { type: "function", function: { name: (tc as Json).name } };
  return undefined;
}

function mapStop(reason: string): string {
  switch (reason) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls":
    case "function_call": return "tool_use";
    default: return "end_turn";
  }
}

// translate one upstream openai chat.completion into an anthropic message
export function openAiCompletionToAnthropicMessage(resp: any, model: string): Json {
  const choice = resp?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content: any[] = [];

  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const tc of message.tool_calls ?? []) {
    let input: any = {};
    try { input = JSON.parse(tc?.function?.arguments ?? "{}"); } catch { input = {}; }
    content.push({ type: "tool_use", id: tc?.id, name: tc?.function?.name, input });
  }

  const usage = resp?.usage ?? {};
  return {
    id: `msg_${resp?.id ?? Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    stop_reason: mapStop(choice.finish_reason ?? "stop"),
    stop_sequence: null,
    content,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}

// stateful translator: upstream openai sse chunks -> anthropic sse events
export class AnthropicStreamEncoder {
  private started = false;
  private model = "";
  private textIndex: number | null = null;
  private textStarted = false;
  private textStopped = false;
  private thinkingIndex: number | null = null;
  private thinkingStarted = false;
  private thinkingStopped = false;
  private toolBlocks = new Map<number, { index: number; id: string; name: string }>();
  private nextIndex = 0;
  private usage = { input_tokens: 0, output_tokens: 0 };
  private stopReason: string | null = null;

  push(chunk: Json, model: string): string[] {
    if (model) this.model = model;
    const out: string[] = [];
    const choice = chunk?.choices?.[0];

    if (!this.started) {
      out.push(sseEvent("message_start", {
        type: "message_start",
        message: {
          id: `msg_${chunk?.id ?? Date.now()}`,
          type: "message",
          role: "assistant",
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.usage.input_tokens, output_tokens: 0 },
        },
      }));
      this.started = true;
    }

    if (chunk?.usage) {
      if (typeof chunk.usage.prompt_tokens === "number") this.usage.input_tokens = chunk.usage.prompt_tokens;
      if (typeof chunk.usage.completion_tokens === "number") this.usage.output_tokens = chunk.usage.completion_tokens;
    }

    if (!choice) return out;

    const delta = choice.delta ?? {};

    // translate upstream reasoning delta into an Anthropic thinking block
    const reasoningText =
      typeof delta.reasoning === "string" && delta.reasoning.length > 0
        ? delta.reasoning
        : typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0
          ? delta.reasoning_content
          : null;
    if (reasoningText) {
      if (this.thinkingIndex === null) {
        this.thinkingIndex = this.nextIndex++;
        this.thinkingStarted = true;
        out.push(sseEvent("content_block_start", {
          type: "content_block_start",
          index: this.thinkingIndex,
          content_block: { type: "thinking", thinking: "" },
        }));
      }
      out.push(sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: this.thinkingIndex,
        delta: { type: "thinking_delta", thinking: reasoningText },
      }));
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (this.thinkingStarted && !this.thinkingStopped && this.thinkingIndex !== null) {
        out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: this.thinkingIndex }));
        this.thinkingStopped = true;
      }
      if (this.textIndex === null) {
        this.textIndex = this.nextIndex++;
        this.textStarted = true;
        out.push(sseEvent("content_block_start", {
          type: "content_block_start",
          index: this.textIndex,
          content_block: { type: "text", text: "" },
        }));
      }
      out.push(sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: this.textIndex,
        delta: { type: "text_delta", text: delta.content },
      }));
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const ti = typeof tc.index === "number" ? tc.index : 0;
        let blk = this.toolBlocks.get(ti);
        if (!blk) {
          if (this.thinkingStarted && !this.thinkingStopped && this.thinkingIndex !== null) {
            out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: this.thinkingIndex }));
            this.thinkingStopped = true;
          }
          if (this.textStarted && !this.textStopped && this.textIndex !== null) {
            out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: this.textIndex }));
            this.textStopped = true;
          }
          const index = this.nextIndex++;
          blk = { index, id: tc.id ?? `tool_${ti}`, name: tc.function?.name ?? `tool_${ti}` };
          this.toolBlocks.set(ti, blk);
          out.push(sseEvent("content_block_start", {
            type: "content_block_start",
            index,
            content_block: { type: "tool_use", id: blk.id, name: blk.name, input: {} },
          }));
        }
        if (typeof tc.function?.arguments === "string" && tc.function.arguments.length > 0) {
          out.push(sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: blk.index,
            delta: { type: "input_json_delta", partial_json: tc.function.arguments },
          }));
        }
      }
    }

    if (choice.finish_reason) this.stopReason = mapStop(choice.finish_reason);
    return out;
  }

  close(): string[] {
    const out: string[] = [];
    if (this.thinkingStarted && !this.thinkingStopped && this.thinkingIndex !== null) {
      out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: this.thinkingIndex }));
      this.thinkingStopped = true;
    }
    if (this.textStarted && !this.textStopped && this.textIndex !== null) {
      out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: this.textIndex }));
      this.textStopped = true;
    }
    for (const blk of this.toolBlocks.values()) {
      out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: blk.index }));
    }
    out.push(sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: this.stopReason ?? "end_turn", stop_sequence: null },
      usage: { output_tokens: this.usage.output_tokens },
    }));
    out.push(sseEvent("message_stop", { type: "message_stop" }));
    return out;
  }
}
