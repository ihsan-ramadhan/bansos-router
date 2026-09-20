import test from "node:test";
import assert from "node:assert/strict";
import { streamToChatResponse } from "../src/daemon/server";

function sse(frames: Array<Record<string, unknown>>): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const call = (i: number, d: Record<string, unknown>) => ({
  choices: [{ index: 0, delta: { tool_calls: [{ index: i, ...d }] } }],
});

test("tool call deltas are reassembled into one call", async () => {
  const res = await streamToChatResponse(
    sse([
      call(0, { id: "call_1", function: { name: "grep", arguments: '{"pat' } }),
      call(0, { function: { arguments: 'tern":"x"}' } }),
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]),
    "m",
    new Set(["grep"]),
  );
  const body: any = await res.json();

  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(body.choices[0].message.tool_calls, [
    { id: "call_1", type: "function", function: { name: "grep", arguments: '{"pattern":"x"}' } },
  ]);
});

test("calls to tools the caller never declared are swallowed", async () => {
  const res = await streamToChatResponse(
    sse([
      { choices: [{ index: 0, delta: { content: "let me look" } }] },
      call(0, { id: "call_9", function: { name: "shell", arguments: "{}" } }),
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]),
    "m",
    new Set(),
  );
  const body: any = await res.json();

  assert.equal(body.choices[0].message.tool_calls, undefined, "injected call is not handed back");
  assert.equal(body.choices[0].finish_reason, "stop", "and the turn is not reported as tool_calls");
  assert.equal(body.choices[0].message.content, "let me look");
});

test("the caller's own calls survive alongside an injected one", async () => {
  const res = await streamToChatResponse(
    sse([
      call(0, { id: "a", function: { name: "shell", arguments: "{}" } }),
      call(1, { id: "b", function: { name: "read_file", arguments: '{"p":"x"}' } }),
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]),
    "m",
    new Set(["read_file"]),
  );
  const body: any = await res.json();

  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(
    body.choices[0].message.tool_calls.map((t: any) => t.function.name),
    ["read_file"],
  );
});

test("omitting the caller set keeps every call (no filtering)", async () => {
  const res = await streamToChatResponse(
    sse([call(0, { id: "a", function: { name: "shell", arguments: "{}" } })]),
    "m",
  );
  const body: any = await res.json();
  assert.equal(body.choices[0].message.tool_calls.length, 1);
});

test("a plain content stream still folds into one message", async () => {
  const res = await streamToChatResponse(
    sse([
      { choices: [{ index: 0, delta: { content: "hel" } }] },
      { choices: [{ index: 0, delta: { content: "lo" } }], usage: { total_tokens: 3 } },
    ]),
    "m",
    new Set(),
  );
  const body: any = await res.json();

  assert.equal(body.choices[0].message.content, "hello");
  assert.equal(body.choices[0].message.tool_calls, undefined);
  assert.deepEqual(body.usage, { total_tokens: 3 });
});

import { Readable } from "node:stream";
import { declaredToolNames, filterInjectedToolCallsTransform } from "../src/daemon/server";

async function pipeThrough(frames: string[], callerTools: Set<string>): Promise<string> {
  const out: string[] = [];
  const tx = Readable.from(frames).pipe(filterInjectedToolCallsTransform(callerTools));
  for await (const c of tx) out.push(c.toString());
  return out.join("");
}

const frame = (d: Record<string, unknown>) => `data: ${JSON.stringify(d)}\n\n`;
const delta = (i: number, d: Record<string, unknown>) =>
  frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, ...d }] } }] });

test("a streamed call to an injected tool never reaches the client", async () => {
  const out = await pipeThrough(
    [
      delta(0, { id: "c1", function: { name: "shell", arguments: "" } }),
      delta(0, { function: { arguments: '{"cmd":"ls"}' } }),
      frame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]\n\n",
    ],
    new Set(),
  );

  assert.ok(!out.includes("shell"), "injected call is gone");
  assert.ok(!out.includes('"cmd":"ls"'), "and so are its argument deltas");
  assert.ok(out.includes('"finish_reason":"stop"'), "the turn is not reported as tool_calls");
  assert.ok(out.endsWith("data: [DONE]\n\n"));
});

test("a streamed call the caller declared passes through untouched", async () => {
  const frames = [
    delta(0, { id: "c1", function: { name: "grep", arguments: '{"p"' } }),
    delta(0, { function: { arguments: ':"x"}' } }),
    frame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
  ];
  const out = await pipeThrough(frames, new Set(["grep"]));

  assert.equal(out, frames.join(""), "byte-identical when nothing is filtered");
});

test("streaming keeps the caller's call while dropping ours in the same turn", async () => {
  const out = await pipeThrough(
    [
      delta(0, { id: "a", function: { name: "read", arguments: "{}" } }),
      delta(1, { id: "b", function: { name: "grep", arguments: "{}" } }),
      frame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    ],
    new Set(["grep"]),
  );

  assert.ok(!out.includes('"name":"read"'));
  assert.ok(out.includes('"name":"grep"'));
  assert.ok(out.includes('"finish_reason":"tool_calls"'), "a real call still ends as tool_calls");
});

test("frames split across chunk boundaries are still filtered", async () => {
  const whole = delta(0, { id: "a", function: { name: "shell", arguments: "{}" } });
  const out = await pipeThrough([whole.slice(0, 20), whole.slice(20)], new Set());
  assert.ok(!out.includes("shell"));
});

test("content-only frames are passed through byte-exact", async () => {
  const frames = [frame({ choices: [{ index: 0, delta: { content: "hi" } }] }), "data: [DONE]\n\n"];
  assert.equal(await pipeThrough(frames, new Set()), frames.join(""));
});

test("declaredToolNames reads both chat and responses tool shapes", () => {
  assert.deepEqual(
    [...declaredToolNames({ tools: [{ function: { name: "a" } }, { name: "b" }, { junk: 1 }] })],
    ["a", "b"],
  );
  assert.equal(declaredToolNames({}).size, 0);
  assert.equal(declaredToolNames(null).size, 0);
});
