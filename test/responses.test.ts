import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseResponsesTurn,
  renderResponse,
  renderResponsesEvent,
  ResponsesStreamEncoder,
} from "../src/protocols/responses";

test("parseResponsesTurn: bare string input becomes a user message", () => {
  const r = parseResponsesTurn({ model: "hy3-free", input: "hello world" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.model, "hy3-free");
  assert.equal(r.value.messages.length, 1);
  const m0 = r.value.messages[0]!;
  assert.equal(m0.role, "user");
  assert.equal(m0.content, "hello world");
});

test("parseResponsesTurn: instructions -> system, input[] items -> messages", () => {
  const r = parseResponsesTurn({
    model: "hy3-free",
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
  assert.equal(r.value.messages.length, 4);
  assert.equal(r.value.messages[0]!.role, "user");
  // function_call -> assistant tool_calls (3rd message: user, plaintext assistant, then tool-call assistant)
  const assistant = r.value.messages[2]!;
  assert.equal(assistant.role, "assistant");
  assert.ok(assistant.toolCalls && assistant.toolCalls[0]!.name === "get_weather");
  // function_call_output -> tool message
  const tool = r.value.messages[3]!;
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
    model: "hy3-free",
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
    model: "hy3-free",
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
  const m0 = r.value.messages[0]!;
  assert.match(String(m0.content), /describe/);
  assert.match(String(m0.content), /this/);
  assert.match(String(m0.content), /\[image/);
});

test("parseResponsesTurn: rejects missing model/input", () => {
  assert.equal(parseResponsesTurn({ input: "x" }).ok, false);
  assert.equal(parseResponsesTurn({ model: "hy3-free" }).ok, false);
});

test("renderResponse: chat completion -> responses object with message output", () => {
  const out = renderResponse(
    {
      id: "chatcmpl-1",
      choices: [{ message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
    "hy3-free",
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
    "hy3-free",
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
  const open = enc.open("hy3-free").join("");
  assert.match(open, /event: response\.created/);
  assert.match(open, /event: response\.in_progress/);
  assert.match(open, /event: response\.output_item\.added/);

  const delta = enc.push({ choices: [{ delta: { content: "Hi" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }).join("");
  assert.match(delta, /event: response\.output_text\.delta/);
  assert.match(delta, /"delta":"Hi"/);
  assert.doesNotMatch(delta, /event: response\.content_part\.added/);

  const close = enc.close().join("");
  assert.match(close, /event: response\.output_text\.done/);
  assert.match(close, /"text":"Hi"/);
  assert.match(close, /event: response\.output_item\.done/);
  assert.match(close, /event: response\.completed/);
  assert.match(close, /"input_tokens":3/);
  // Codex reads the final result from response.completed.output
  assert.match(close, /"output":\[\{"id":"msg_/);
  assert.match(close, /"type":"output_text","text":"Hi"/);
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
    "hy3-free",
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
