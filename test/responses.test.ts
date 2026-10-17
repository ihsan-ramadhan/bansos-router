import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseResponsesTurn,
  renderResponse,
  renderResponsesEvent,
  ResponsesStreamEncoder,
} from "../src/protocols/responses";

test("parseResponsesTurn: bare string input becomes a user message", () => {
  const r = parseResponsesTurn({ model: "mimo-v2.5-free", input: "hello world" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.model, "mimo-v2.5-free");
  assert.equal(r.value.messages.length, 1);
  const m0 = r.value.messages[0]!;
  assert.equal(m0.role, "user");
  assert.equal(m0.content, "hello world");
});

test("parseResponsesTurn: instructions -> system, input[] items -> messages", () => {
  const r = parseResponsesTurn({
    model: "mimo-v2.5-free",
    instructions: "You are a helpful assistant.",
    input: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
      {
        type: "function_call",
        name: "get_weather",
        call_id: "call_1",
        arguments: '{"city":"Paris"}',
      },
      { type: "function_call_output", call_id: "call_1", output: "18C" },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.system, "You are a helpful assistant.");
  assert.equal(r.value.messages.length, 3);
  assert.equal(r.value.messages[0]!.role, "user");
  const assistant = r.value.messages[1]!;
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, "hello there");
  assert.ok(assistant.toolCalls && assistant.toolCalls[0]!.name === "get_weather");
  const tool = r.value.messages[2]!;
  assert.equal(tool.role, "tool");
  assert.equal(tool.toolCallId, "call_1");
});

test("parseResponsesTurn: reasoning.effort and max_output_tokens mapped", () => {
  const r = parseResponsesTurn({
    model: "nemotron-3-ultra-free",
    input: "think",
    reasoning: { effort: "high" },
    max_output_tokens: 2048,
    stream: true,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.reasoningEffort, "high");
  assert.equal(r.value.maxTokens, 2048);
  assert.equal(r.value.stream, true);
});

test("parseResponsesTurn: tools mapped to internal format without type field", () => {
  const r = parseResponsesTurn({
    model: "mimo-v2.5-free",
    input: "use a tool",
    tools: [
      { type: "function", name: "get_weather", description: "get weather", parameters: { type: "object" } },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.value.tools && r.value.tools.length === 1);
  const t = r.value.tools![0]!;
  // internal form must drop the "type" wrapper so it can be re-wrapped for chat
  assert.equal(t.name, "get_weather");
  assert.equal(t.description, "get weather");
  assert.deepEqual(t.parameters, { type: "object" });
  assert.equal(("type" in t), false);
});

test("parseResponsesTurn: input array of content blocks", () => {
  const r = parseResponsesTurn({
    model: "mimo-v2.5-free",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "describe " },
          { type: "input_image", image_url: "https://x/y.png" },
          { type: "input_text", text: "this" },
        ],
      },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.messages[0]!.content, [
    { type: "text", text: "describe " },
    { type: "image_url", url: "https://x/y.png" },
    { type: "text", text: "this" },
  ]);
});

test("parseResponsesTurn: parallel function calls share one assistant message", () => {
  const r = parseResponsesTurn({
    model: "m",
    input: [
      { role: "user", content: "both" },
      { type: "function_call", call_id: "a", name: "read", arguments: "{}" },
      { type: "function_call", call_id: "b", name: "bash", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: "1" },
      { type: "function_call_output", call_id: "b", output: "2" },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.messages.map((m) => m.role), ["user", "assistant", "tool", "tool"]);
  assert.deepEqual(r.value.messages[1]!.toolCalls!.map((c) => c.id), ["a", "b"]);
});

test("parseResponsesTurn: replayed reasoning items are skipped, not rejected", () => {
  const r = parseResponsesTurn({
    model: "m",
    input: [
      { role: "user", content: "hi" },
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
      { role: "user", content: "again" },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.messages.map((m) => m.content), ["hi", "hello", "again"]);
});

test("parseResponsesTurn: rejects missing model/input", () => {
  assert.equal(parseResponsesTurn({ input: "x" }).ok, false);
  assert.equal(parseResponsesTurn({ model: "mimo-v2.5-free" }).ok, false);
});

test("renderResponse: chat completion -> responses object with message output", () => {
  const out = renderResponse(
    {
      id: "chatcmpl-1",
      choices: [{ message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
    "mimo-v2.5-free",
  ) as any;
  assert.equal(out.object, "response");
  assert.equal(out.status, "completed");
  assert.equal(out.output[0].type, "message");
  assert.equal(out.output[0].content[0].text, "Hi!");
  assert.equal(out.usage.input_tokens, 5);
  assert.equal(out.usage.output_tokens, 2);
});

test("renderResponse: tool_calls -> function_call output item", () => {
  const out = renderResponse(
    {
      choices: [{
        message: {
          role: "assistant",
          tool_calls: [{ id: "call_9", function: { name: "get_weather", arguments: "{}" } }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    },
    "mimo-v2.5-free",
  ) as any;
  assert.equal(out.output[0].type, "function_call");
  assert.equal(out.output[0].name, "get_weather");
});

test("renderResponsesEvent: wraps payload with event and data lines", () => {
  const ev = renderResponsesEvent("response.created", { foo: 1 });
  assert.match(ev, /^event: response\.created\n/);
  assert.match(ev, /data: {"type":"response.created","foo":1}\n\n$/);
});

test("ResponsesStreamEncoder: open/push/close emits spec event sequence", () => {
  const enc = new ResponsesStreamEncoder();
  const open = enc.open("mimo-v2.5-free").join("");
  assert.match(open, /event: response\.created/);
  assert.match(open, /event: response\.in_progress/);

  const delta = enc.push({ choices: [{ delta: { content: "Hi" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }).join("");
  assert.match(delta, /event: response\.output_item\.added/);
  assert.match(delta, /event: response\.content_part\.added/);
  assert.match(delta, /event: response\.output_text\.delta/);
  assert.match(delta, /"delta":"Hi"/);
  assert.doesNotMatch(enc.push({ choices: [{ delta: { content: "!" } }] }).join(""), /output_item\.added/);

  const close = enc.close().join("");
  assert.match(close, /event: response\.output_text\.done/);
  assert.match(close, /"text":"Hi!"/);
  assert.match(close, /event: response\.output_item\.done/);
  assert.match(close, /event: response\.completed/);
  assert.match(close, /"input_tokens":3/);
  // Codex reads the final result from response.completed.output
  assert.match(close, /"output":\[\{"id":"msg_/);
  assert.match(close, /"type":"output_text","text":"Hi!"/);
});

test("renderResponse: empty content + reasoning falls back to reasoning text", () => {
  const out = renderResponse(
    {
      id: "chatcmpl-2",
      choices: [{
        message: {
          role: "assistant",
          content: "",
          reasoning: "The number in the image is 42.",
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
    "stepfun/step-3.7-flash:free",
  ) as any;
  assert.equal(out.output[0].content[0].text, "The number in the image is 42.");
});

test("renderResponse: non-empty content is kept untouched (no reasoning merge)", () => {
  const out = renderResponse(
    {
      id: "chatcmpl-3",
      choices: [{
        message: {
          role: "assistant",
          content: "The answer is 42.",
          reasoning: "I think the answer is 42 but let me double check.",
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
    "mimo-v2.5-free",
  ) as any;
  assert.equal(out.output[0].content[0].text, "The answer is 42.");
});

test("ResponsesStreamEncoder: empty content but reasoning deltas surface as text", () => {
  const enc = new ResponsesStreamEncoder();
  enc.open("stepfun/step-3.7-flash:free");
  // upstream drops the answer into reasoning deltas, no content delta at all
  enc.push({ choices: [{ delta: { reasoning: "The number is " } }] });
  enc.push({ choices: [{ delta: { reasoning: "42." } }] });
  const close = enc.close().join("");
  // intermediate done events must use the resolved text, not an empty buffer
  assert.match(close, /event: response\.output_text\.done/);
  assert.match(close, /"text":"The number is 42\."/);
  assert.match(close, /"type":"output_text","text":"The number is 42\."/);
});

function events(wire: string[]): Array<Record<string, any>> {
  return wire.join("").split("\n\n").filter(Boolean).map((f) => JSON.parse(f.split("\ndata: ")[1]!));
}

test("ResponsesStreamEncoder: streamed tool calls become function_call items", () => {
  const enc = new ResponsesStreamEncoder(new Set(["shell", "read"]));
  const wire = [
    ...enc.open("m"),
    ...enc.push({ choices: [{ delta: { content: "Checking." } }] }),
    ...enc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "shell", arguments: "" } }] } }] }),
    ...enc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":' } }] } }] }),
    ...enc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] } }] }),
    ...enc.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "read", arguments: '{"path":"x"}' } }] } }] }),
    ...enc.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    ...enc.close(),
  ];
  const evs = events(wire);
  const types = evs.map((e) => e.type);
  assert.equal(types[0], "response.created");
  assert.equal(types.at(-1), "response.completed");
  assert.ok(types.indexOf("response.output_item.done") < types.indexOf("response.function_call_arguments.delta"), "text item closes before the first call opens");
  const done = evs.filter((e) => e.type === "response.function_call_arguments.done");
  assert.deepEqual(done.map((e) => e.arguments), ['{"cmd":"ls"}', '{"path":"x"}']);
  const output = evs.at(-1)!.response.output;
  assert.deepEqual(output.map((o: any) => o.type), ["message", "function_call", "function_call"]);
  assert.deepEqual(output.slice(1).map((o: any) => [o.call_id, o.name]), [["call_a", "shell"], ["call_b", "read"]]);
  assert.deepEqual(output.map((o: any) => o.id), [...new Set(output.map((o: any) => o.id))]);
});

test("ResponsesStreamEncoder: calls to tools the caller never declared are hidden", () => {
  const enc = new ResponsesStreamEncoder(new Set(["grep"]));
  const wire = [
    ...enc.open("m"),
    ...enc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "z", function: { name: "shell", arguments: "{}" } }] } }] }),
    ...enc.close(),
  ];
  const output = events(wire).at(-1)!.response.output;
  assert.ok(!JSON.stringify(wire).includes("function_call_arguments"));
  assert.deepEqual(output.map((o: any) => o.type), ["message"]);
});

test("ResponsesStreamEncoder: an empty upstream stream still opens with response.created", () => {
  const enc = new ResponsesStreamEncoder();
  const types = events(enc.close()).map((e) => e.type);
  assert.equal(types[0], "response.created");
  assert.equal(types.at(-1), "response.completed");
  assert.ok(types.includes("response.content_part.done"));
});

test("renderResponse: text alongside tool calls is kept", () => {
  const out = renderResponse(
    { choices: [{ message: { content: "Let me check.", tool_calls: [{ id: "c1", function: { name: "read", arguments: "{}" } }] } }] },
    "m",
  ) as any;
  assert.deepEqual(out.output.map((o: any) => o.type), ["message", "function_call"]);
  assert.equal(out.output[1].call_id, "c1");
});

test("ResponsesStreamEncoder: planning before a hidden tool call is not promoted to the answer", () => {
  const enc = new ResponsesStreamEncoder(new Set(["exec_command"]));
  const wire = [
    ...enc.open("m"),
    ...enc.push({ choices: [{ delta: { reasoning: "I will call read" } }] }),
    ...enc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "z", function: { name: "read", arguments: "{}" } }] } }] }),
    ...enc.close(),
  ].join("");
  assert.doesNotMatch(wire, /"output_text","text":"I will call read"/);
  assert.doesNotMatch(wire, /response\.output_text\.delta/);
});
