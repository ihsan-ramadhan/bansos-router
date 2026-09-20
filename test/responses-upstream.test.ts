import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  chatToResponsesBody,
  responsesToChatJson,
  responsesToChatStream,
  toChatResponse,
} from "../src/protocols/responses-upstream";
import { SEEDED_MODELS } from "../src/upstreams";
import { pickSmartDefaultModel } from "../src/upstreams/types";

// frames captured from opencode.ai/zen/v1/responses (muse-spark-1.2-contributor-free)
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `event: ${e.type as string}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

async function collect(input: string | string[], modelId = "muse"): Promise<string> {
  const chunks = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  const stream = Readable.from(chunks).pipe(responsesToChatStream(modelId));
  for await (const c of stream) out.push(c.toString());
  return out.join("");
}

function chunksOf(raw: string): any[] {
  return raw
    .split("\n\n")
    .map((f) => f.replace(/^data: /, "").trim())
    .filter((p) => p && p !== "[DONE]")
    .map((p) => JSON.parse(p));
}

test("chatToResponsesBody maps roles, images, and token limits", () => {
  const body = chatToResponsesBody(
    {
      messages: [
        { role: "system", content: "be terse" },
        { role: "developer", content: "no emoji" },
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
          ],
        },
      ],
      max_tokens: 512,
      temperature: 0.2,
      stream: true,
    },
    "muse",
  ) as any;

  assert.equal(body.model, "muse");
  assert.equal(body.instructions, "be terse\n\nno emoji");
  assert.equal(body.max_output_tokens, 512);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, undefined);
  assert.deepEqual(body.input, [
    {
      role: "user",
      content: [
        { type: "input_text", text: "what is this" },
        { type: "input_image", image_url: "data:image/png;base64,AAA" },
      ],
    },
  ]);
});

test("chatToResponsesBody flattens tools and round-trips a tool exchange", () => {
  const body = chatToResponsesBody(
    {
      messages: [
        { role: "user", content: "weather in Jakarta?" },
        {
          role: "assistant",
          content: "checking",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Jakarta"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "31C" },
      ],
      tools: [
        {
          type: "function",
          function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } },
        },
      ],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    },
    "muse",
  ) as any;

  assert.deepEqual(body.tools, [
    { type: "function", name: "get_weather", description: "Get weather", parameters: { type: "object" } },
  ]);
  assert.deepEqual(body.tool_choice, { type: "function", name: "get_weather" });
  assert.deepEqual(body.input, [
    { role: "user", content: [{ type: "input_text", text: "weather in Jakarta?" }] },
    { role: "assistant", content: [{ type: "output_text", text: "checking" }] },
    { type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"Jakarta"}' },
    { type: "function_call_output", call_id: "call_1", output: "31C" },
  ]);
});

test("chatToResponsesBody never forwards a reasoning block", () => {
  const body = chatToResponsesBody(
    { messages: [{ role: "user", content: "hi" }], reasoning_effort: "none" },
    "muse",
  ) as any;
  assert.equal(body.reasoning, undefined);
  assert.equal(body.reasoning_effort, undefined);
});

test("responsesToChatJson folds output items into an openai chat completion", () => {
  const chat = responsesToChatJson(
    {
      id: "resp_1",
      status: "completed",
      created_at: 111,
      output: [
        { type: "reasoning", content: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] },
      ],
      usage: { input_tokens: 12, output_tokens: 60, total_tokens: 72 },
    },
    "muse",
  ) as any;

  assert.equal(chat.object, "chat.completion");
  assert.equal(chat.model, "muse");
  assert.equal(chat.choices[0].message.content, "OK");
  assert.equal(chat.choices[0].finish_reason, "stop");
  assert.deepEqual(chat.usage, { prompt_tokens: 12, completion_tokens: 60, total_tokens: 72 });
});

test("responsesToChatJson maps function_call items to tool_calls", () => {
  const chat = responsesToChatJson(
    {
      status: "completed",
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "pulling it" }] },
        { type: "function_call", call_id: "call_9", name: "get_weather", arguments: '{"city":"Jakarta"}' },
      ],
    },
    "muse",
  ) as any;

  assert.equal(chat.choices[0].finish_reason, "tool_calls");
  assert.equal(chat.choices[0].message.content, "pulling it");
  assert.deepEqual(chat.choices[0].message.tool_calls, [
    { id: "call_9", type: "function", function: { name: "get_weather", arguments: '{"city":"Jakarta"}' } },
  ]);
});

test("responsesToChatJson reports an incomplete response as finish_reason length", () => {
  const chat = responsesToChatJson({ status: "incomplete", output: [] }, "muse") as any;
  assert.equal(chat.choices[0].finish_reason, "length");
});

test("responsesToChatStream turns text deltas into chat chunks and terminates with [DONE]", async () => {
  const raw = await collect(
    sse([
      { type: "response.created", sequence_number: 0 },
      { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "message", role: "assistant" } },
      { type: "response.output_text.delta", output_index: 1, delta: "one two three" },
      { type: "ping", cost: "0" },
      {
        type: "response.completed",
        response: { status: "completed", usage: { input_tokens: 13, output_tokens: 193, total_tokens: 206 } },
      },
    ]),
  );

  assert.ok(raw.endsWith("data: [DONE]\n\n"));
  const chunks = chunksOf(raw);
  assert.equal(chunks[0].choices[0].delta.role, "assistant");
  assert.equal(chunks[0].choices[0].delta.content, "one two three");
  const final = chunks[chunks.length - 1];
  assert.equal(final.choices[0].finish_reason, "stop");
  assert.deepEqual(final.usage, { prompt_tokens: 13, completion_tokens: 193, total_tokens: 206 });
});

test("responsesToChatStream emits tool calls with chat ordinals, not output indexes", async () => {
  const raw = await collect(
    sse([
      { type: "response.output_item.added", output_index: 0, item: { type: "reasoning" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "message", role: "assistant" } },
      {
        type: "response.output_item.added",
        output_index: 2,
        item: { type: "function_call", name: "get_weather", call_id: "call_7" },
      },
      { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"city":' },
      { type: "response.function_call_arguments.delta", output_index: 2, delta: '"Jakarta"}' },
      { type: "response.completed", response: { status: "completed" } },
    ]),
  );

  const chunks = chunksOf(raw);
  const toolChunks = chunks.filter((c) => c.choices[0].delta.tool_calls);
  // responses called it output_index 2; chat must see the first tool call as 0
  assert.equal(toolChunks[0].choices[0].delta.tool_calls[0].index, 0);
  assert.equal(toolChunks[0].choices[0].delta.tool_calls[0].id, "call_7");
  assert.equal(toolChunks[0].choices[0].delta.tool_calls[0].function.name, "get_weather");
  const args = toolChunks
    .map((c) => c.choices[0].delta.tool_calls[0].function?.arguments ?? "")
    .join("");
  assert.equal(args, '{"city":"Jakarta"}');
  assert.equal(chunks[chunks.length - 1].choices[0].finish_reason, "tool_calls");
});

test("responsesToChatStream reassembles frames split across chunks", async () => {
  const full = sse([
    { type: "response.output_text.delta", output_index: 0, delta: "hello" },
    { type: "response.completed", response: { status: "completed" } },
  ]);
  const cut = Math.floor(full.length / 3);
  const raw = await collect([full.slice(0, cut), full.slice(cut, cut * 2), full.slice(cut * 2)]);
  const chunks = chunksOf(raw);
  assert.equal(chunks[0].choices[0].delta.content, "hello");
  assert.ok(raw.endsWith("data: [DONE]\n\n"));
});

test("responsesToChatStream closes the stream when the upstream cuts off early", async () => {
  const raw = await collect(
    sse([{ type: "response.output_text.delta", output_index: 0, delta: "partial" }]),
  );
  const chunks = chunksOf(raw);
  assert.equal(chunks[chunks.length - 1].choices[0].finish_reason, "stop");
  assert.ok(raw.endsWith("data: [DONE]\n\n"));
});

test("responsesToChatStream marks a truncated response as finish_reason length", async () => {
  const raw = await collect(
    sse([
      { type: "response.output_text.delta", output_index: 0, delta: "cut" },
      { type: "response.incomplete", response: { status: "incomplete" } },
    ]),
  );
  const chunks = chunksOf(raw);
  assert.equal(chunks[chunks.length - 1].choices[0].finish_reason, "length");
});

test("muse spark is seeded on the responses wire and is the smart default", () => {
  const muse = SEEDED_MODELS.find((m) => m.id === "muse-spark-1.3-contributor-free");
  assert.ok(muse, "muse-spark-1.3-contributor-free must be seeded");
  assert.equal(muse.wireApi, "responses");
  assert.equal(pickSmartDefaultModel(SEEDED_MODELS), "muse-spark-1.3-contributor-free");
});

test("toChatResponse leaves a non-JSON reply readable instead of consuming it", async () => {
  const upstream = new Response("<html>gateway error</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const out = await toChatResponse(upstream, "muse", false);
  // reading .json() and handing back the original Response would make this throw
  assert.equal(await out.text(), "<html>gateway error</html>");
  assert.equal(out.status, 200);
});

test("toChatResponse surfaces an upstream reset instead of crashing the process", async () => {
  const broken = new Readable({
    read() {
      this.destroy(new Error("upstream reset"));
    },
  });
  const out = await toChatResponse(
    new Response(Readable.toWeb(broken) as any, { status: 200 }),
    "muse",
    true,
  );

  // pipe() would leave this as an unhandled 'error' on the source, which node
  // turns into an uncaught exception and the daemon has no global guard for
  await assert.rejects(async () => {
    for await (const _chunk of Readable.fromWeb(out.body as any)) {
      // drain
    }
  }, /upstream reset/);
});

test("responsesToChatStream takes tool arguments handed over whole", async () => {
  const raw = await collect(
    sse([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", name: "get_weather", call_id: "call_1", arguments: '{"city":"Jakarta"}' },
      },
      { type: "response.completed", response: { status: "completed" } },
    ]),
  );
  const args = chunksOf(raw)
    .filter((c) => c.choices[0].delta.tool_calls)
    .map((c) => c.choices[0].delta.tool_calls[0].function?.arguments ?? "")
    .join("");
  assert.equal(args, '{"city":"Jakarta"}');
});

test("responsesToChatStream falls back to the arguments done event", async () => {
  const raw = await collect(
    sse([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", name: "get_weather", call_id: "call_1" },
      },
      { type: "response.function_call_arguments.done", output_index: 0, arguments: '{"city":"Bandung"}' },
      { type: "response.completed", response: { status: "completed" } },
    ]),
  );
  const args = chunksOf(raw)
    .filter((c) => c.choices[0].delta.tool_calls)
    .map((c) => c.choices[0].delta.tool_calls[0].function?.arguments ?? "")
    .join("");
  assert.equal(args, '{"city":"Bandung"}');
});

test("responsesToChatStream does not repeat arguments already streamed as deltas", async () => {
  const raw = await collect(
    sse([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", name: "get_weather", call_id: "call_1" },
      },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"city":"Solo"}' },
      { type: "response.function_call_arguments.done", output_index: 0, arguments: '{"city":"Solo"}' },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "function_call", name: "get_weather", arguments: '{"city":"Solo"}' },
      },
      { type: "response.completed", response: { status: "completed" } },
    ]),
  );
  const args = chunksOf(raw)
    .filter((c) => c.choices[0].delta.tool_calls)
    .map((c) => c.choices[0].delta.tool_calls[0].function?.arguments ?? "")
    .join("");
  assert.equal(args, '{"city":"Solo"}');
});

test("chatToResponsesBody forwards pdf parts instead of dropping them", () => {
  const body = chatToResponsesBody(
    {
      model: "muse",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "transcribe and summarise" },
            { type: "file", file: { file_data: "JVBERi0x", filename: "spec.pdf" } },
          ],
        },
      ],
    },
    "muse",
  ) as any;

  const parts = body.input[0].content;
  assert.deepEqual(parts, [
    { type: "input_text", text: "transcribe and summarise" },
    { type: "input_file", file_data: "JVBERi0x", filename: "spec.pdf" },
  ]);
});

test("a message whose parts are all unmappable is omitted, not sent empty", () => {
  const body = chatToResponsesBody(
    {
      model: "muse",
      messages: [{ role: "user", content: [{ type: "video_url", video_url: { url: "x" } }] }],
    },
    "muse",
  ) as any;
  assert.deepEqual(body.input, []);
});
