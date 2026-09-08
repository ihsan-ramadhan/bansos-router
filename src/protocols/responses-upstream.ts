// the daemon normalizes every client protocol to openai chat before
// forwarding, but zen's muse spark answers only on /v1/responses and returns
// 500 on /chat/completions. translating both directions here keeps the second
// wire format out of the rest of the pipeline.
import { Readable, Transform, pipeline } from "node:stream";

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("");
}

// the responses API types model output and user input separately, so `role`
// decides which part type the text becomes
function inputParts(content: unknown, role: string): unknown[] {
  const textType = role === "assistant" ? "output_text" : "input_text";
  if (typeof content === "string") return [{ type: textType, text: content }];
  if (!Array.isArray(content)) return [];

  const parts: unknown[] = [];
  for (const p of content as any[]) {
    if (p?.type === "image_url") {
      const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
      if (typeof url === "string") parts.push({ type: "input_image", image_url: url });
      continue;
    }
    if (typeof p?.text === "string") parts.push({ type: textType, text: p.text });
  }
  return parts;
}

// re-shape a responses-wire upstream reply into the openai chat response the
// rest of the daemon expects, so chat, responses and anthropic handlers all
// keep working unchanged.
export async function toChatResponse(
  upstreamRes: Response,
  modelId: string,
  streaming: boolean,
): Promise<Response> {
  if (!upstreamRes.body) return upstreamRes;

  if (!streaming) {
    // read once: reaching for .json() and falling back to the original Response
    // would hand back a body that has already been consumed
    const text = await upstreamRes.text();
    try {
      return new Response(JSON.stringify(responsesToChatJson(JSON.parse(text), modelId)), {
        status: upstreamRes.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      // a gateway error page or an empty body: pass the bytes through untouched
      return new Response(text, {
        status: upstreamRes.status,
        headers: {
          "content-type": upstreamRes.headers.get("content-type") ?? "application/json",
        },
      });
    }
  }

  const src = Readable.fromWeb(upstreamRes.body as import("node:stream/web").ReadableStream);
  const out = responsesToChatStream(modelId);
  // pipe() forwards neither errors nor destroy, so an upstream reset would be an
  // unhandled 'error' that kills the daemon, and a client abort would leave the
  // upstream socket open. pipeline() wires both directions.
  pipeline(src, out, () => {
    // the error already reached the consumer through `out`
  });
  return new Response(Readable.toWeb(out) as unknown as BodyInit, {
    status: upstreamRes.status,
    headers: { "content-type": "text/event-stream" },
  });
}

export function chatToResponsesBody(chatBody: any, modelId: string): unknown {
  const messages = Array.isArray(chatBody?.messages) ? chatBody.messages : [];
  const instructions: string[] = [];
  const input: unknown[] = [];

  for (const m of messages) {
    const role = m?.role;
    if (role === "system" || role === "developer") {
      const text = textOf(m.content);
      if (text) instructions.push(text);
      continue;
    }
    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id ?? randomId("call"),
        output: textOf(m.content),
      });
      continue;
    }
    if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const text = textOf(m.content);
      if (text) input.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const tc of m.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc?.id ?? randomId("call"),
          name: tc?.function?.name ?? "tool",
          arguments: tc?.function?.arguments ?? "{}",
        });
      }
      continue;
    }
    const parts = inputParts(m?.content, role);
    if (parts.length > 0) input.push({ role: role ?? "user", content: parts });
  }

  const body: Record<string, unknown> = { model: modelId, input };
  if (instructions.length > 0) body.instructions = instructions.join("\n\n");

  const maxTokens = chatBody?.max_completion_tokens ?? chatBody?.max_tokens;
  if (typeof maxTokens === "number") body.max_output_tokens = maxTokens;
  if (typeof chatBody?.temperature === "number") body.temperature = chatBody.temperature;
  if (typeof chatBody?.top_p === "number") body.top_p = chatBody.top_p;
  if (chatBody?.stream === true) body.stream = true;

  // no `reasoning` block is ever set: muse rejects `reasoning.effort: "none"`,
  // and the daemon already strips effort for supportsReasoningEffort: false

  // chat nests the schema under `function`; responses flattens it
  if (Array.isArray(chatBody?.tools) && chatBody.tools.length > 0) {
    body.tools = chatBody.tools.map((t: any) => ({
      type: "function",
      name: t?.function?.name ?? t?.name,
      description: t?.function?.description ?? t?.description,
      parameters: t?.function?.parameters ?? t?.parameters,
    }));
  }
  if (chatBody?.tool_choice !== undefined) {
    const tc = chatBody.tool_choice;
    body.tool_choice = tc?.type === "function"
      ? { type: "function", name: tc.function?.name ?? tc.name }
      : tc;
  }

  return body;
}

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function responsesToChatJson(resp: any, modelId: string): unknown {
  const output = Array.isArray(resp?.output) ? resp.output : [];
  let text = "";
  const toolCalls: ChatToolCall[] = [];

  for (const item of output) {
    if (item?.type === "message") {
      text += textOf(item.content);
    } else if (item?.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? randomId("call"),
        type: "function",
        function: {
          name: item.name ?? "tool",
          arguments: typeof item.arguments === "string" ? item.arguments : "{}",
        },
      });
    }
  }

  const finish = toolCalls.length > 0
    ? "tool_calls"
    : resp?.status === "incomplete"
      ? "length"
      : "stop";

  const usage = resp?.usage ?? {};
  const message: Record<string, unknown> = { role: "assistant", content: text };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id: resp?.id ?? randomId("chatcmpl"),
    object: "chat.completion",
    created: resp?.created_at ?? Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    },
  };
}

// stateful because chat needs a tool-call ordinal and a role marker on the
// first delta, neither of which the responses events carry. frames arrive split
// across chunks, so buffer until "\n\n".
export function responsesToChatStream(modelId: string): Transform {
  const id = randomId("chatcmpl");
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let roleSent = false;
  let sawToolCall = false;
  let closed = false;
  // responses numbers every output item, including reasoning; chat numbers only
  // tool calls
  const toolIndexByOutput = new Map<number, number>();
  // upstreams may stream arguments as deltas or hand them over whole on a done
  // event; this keeps the second path from repeating what the first already sent
  const argsSent = new Set<number>();

  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  const withRole = (delta: Record<string, unknown>): Record<string, unknown> => {
    if (roleSent) return delta;
    roleSent = true;
    return { role: "assistant", ...delta };
  };

  const handle = (event: any, push: (s: string) => void): void => {
    switch (event?.type) {
      case "response.output_text.delta": {
        if (typeof event.delta === "string" && event.delta.length > 0) {
          push(chunk(withRole({ content: event.delta })));
        }
        break;
      }
      case "response.output_item.added": {
        if (event.item?.type !== "function_call") break;
        const index = toolIndexByOutput.size;
        toolIndexByOutput.set(event.output_index, index);
        sawToolCall = true;
        const upfront = typeof event.item.arguments === "string" ? event.item.arguments : "";
        if (upfront) argsSent.add(event.output_index);
        push(chunk(withRole({
          tool_calls: [{
            index,
            id: event.item.call_id ?? event.item.id ?? randomId("call"),
            type: "function",
            function: { name: event.item.name ?? "tool", arguments: upfront },
          }],
        })));
        break;
      }
      case "response.function_call_arguments.delta": {
        const index = toolIndexByOutput.get(event.output_index);
        if (index === undefined || typeof event.delta !== "string") break;
        argsSent.add(event.output_index);
        push(chunk({ tool_calls: [{ index, function: { arguments: event.delta } }] }));
        break;
      }
      case "response.function_call_arguments.done":
      case "response.output_item.done": {
        const index = toolIndexByOutput.get(event.output_index);
        if (index === undefined || argsSent.has(event.output_index)) break;
        const whole = typeof event.arguments === "string"
          ? event.arguments
          : typeof event.item?.arguments === "string" ? event.item.arguments : "";
        if (!whole) break;
        argsSent.add(event.output_index);
        push(chunk({ tool_calls: [{ index, function: { arguments: whole } }] }));
        break;
      }
      case "response.completed":
      case "response.incomplete": {
        if (closed) break;
        closed = true;
        const finish = sawToolCall
          ? "tool_calls"
          : event.type === "response.incomplete"
            ? "length"
            : "stop";
        const usage = event.response?.usage;
        const final: Record<string, unknown> = {
          id,
          object: "chat.completion.chunk",
          created,
          model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: finish }],
        };
        if (usage) {
          final.usage = {
            prompt_tokens: usage.input_tokens ?? 0,
            completion_tokens: usage.output_tokens ?? 0,
            total_tokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          };
        }
        push(`data: ${JSON.stringify(final)}\n\n`);
        push("data: [DONE]\n\n");
        break;
      }
      // response.created / in_progress / content_part.* / ping carry no
      // information chat can express
      default:
        break;
    }
  };

  return new Transform({
    transform(input, _enc, cb) {
      buffer += input.toString("utf8");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            handle(JSON.parse(payload), (s) => this.push(s));
          } catch {
            // a malformed frame is not worth killing the stream over
          }
        }
        end = buffer.indexOf("\n\n");
      }
      cb();
    },
    flush(cb) {
      // upstream hung up before response.completed: still terminate the chat
      // stream so the client is not left waiting
      if (!closed) {
        this.push(`data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: sawToolCall ? "tool_calls" : "stop" }],
        })}\n\n`);
        this.push("data: [DONE]\n\n");
      }
      cb();
    },
  });
}
