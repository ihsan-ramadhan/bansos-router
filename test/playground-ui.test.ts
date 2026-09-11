import test from "node:test";
import assert from "node:assert/strict";
import { ResponsesStreamEncoder } from "../src/protocols/responses";
import { AnthropicStreamEncoder } from "../src/protocols/anthropic";
import { sseData } from "../src/protocols/stream";
import {
  dataFromSseFrame,
  extractFrameDeltas,
  extractResponsesDelta,
} from "../src/ui/utils/playground";
import type { WireProtocol } from "../src/ui/types";

// the exact loop the playground hook runs over the response body
function renderInPlayground(wire: string, protocol: WireProtocol): { content: string; reasoning: string } {
  let content = "";
  let reasoning = "";
  for (const frame of wire.split("\n\n")) {
    const dataStr = dataFromSseFrame(frame);
    if (!dataStr || dataStr === "[DONE]") continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(dataStr);
    } catch {
      continue;
    }
    const { delta, reasoningDelta } = extractFrameDeltas(chunk, protocol);
    content += delta;
    reasoning += reasoningDelta;
  }
  return { content, reasoning };
}

const chatChunk = (delta: Record<string, unknown>) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  model: "test-model",
  choices: [{ index: 0, delta, finish_reason: null }],
});

test("dataFromSseFrame reads frames that lead with an event line", () => {
  // chat completions sends a bare data frame
  assert.equal(dataFromSseFrame('data: {"a":1}'), '{"a":1}');
  // anthropic and responses lead with event:, which the old parser dropped
  assert.equal(dataFromSseFrame('event: content_block_delta\ndata: {"a":1}'), '{"a":1}');
  assert.equal(dataFromSseFrame("event: ping\ndata: [DONE]"), "[DONE]");
  // per SSE, several data lines in one frame join with a newline
  assert.equal(dataFromSseFrame("data: one\ndata: two"), "one\ntwo");
  assert.equal(dataFromSseFrame("event: ping"), null);
  assert.equal(dataFromSseFrame(""), null);
});

test("the playground renders a chat completions stream", () => {
  const wire =
    sseData(chatChunk({ role: "assistant", content: "Hello" })) +
    sseData(chatChunk({ content: " world" })) +
    "data: [DONE]\n\n";

  assert.equal(renderInPlayground(wire, "chat").content, "Hello world");
});

test("the playground renders an anthropic stream from the real encoder", () => {
  const enc = new AnthropicStreamEncoder();
  const wire = [
    ...enc.push(chatChunk({ role: "assistant", content: "Hello" }), "test-model"),
    ...enc.push(chatChunk({ content: " world" }), "test-model"),
    ...enc.close(),
  ].join("");

  // every anthropic frame starts with `event:`, so the old parser showed nothing
  assert.ok(wire.includes("event: content_block_delta"));
  assert.equal(renderInPlayground(wire, "anthropic").content, "Hello world");
});

test("the playground renders a responses stream from the real encoder", () => {
  const enc = new ResponsesStreamEncoder();
  const wire = [
    ...enc.open("test-model"),
    ...enc.push(chatChunk({ role: "assistant", content: "Hello" })),
    ...enc.push(chatChunk({ content: " world" })),
    ...enc.close(),
  ].join("");

  assert.ok(wire.includes("event: response.output_text.delta"));
  assert.equal(renderInPlayground(wire, "responses").content, "Hello world");
});

test("extractResponsesDelta matches the event name the daemon actually emits", () => {
  // it used to look for response.output_item.delta / response.text.delta, which
  // the encoder never sends, so every delta was dropped
  assert.equal(
    extractResponsesDelta({ type: "response.output_text.delta", delta: "hi" }).delta,
    "hi",
  );
  assert.equal(extractResponsesDelta({ type: "response.output_item.added", item: {} }).delta, "");
  assert.equal(extractResponsesDelta({ type: "response.completed" }).delta, "");
});

test("an anthropic thinking block reaches the reasoning pane, not the answer", () => {
  const enc = new AnthropicStreamEncoder();
  const wire = [
    ...enc.push(chatChunk({ role: "assistant", reasoning_content: "thinking out loud" }), "test-model"),
    ...enc.push(chatChunk({ content: "the answer" }), "test-model"),
    ...enc.close(),
  ].join("");

  const out = renderInPlayground(wire, "anthropic");
  assert.equal(out.reasoning, "thinking out loud");
  assert.equal(out.content, "the answer");
});

// the daemon's chat path runs the stream through this transform first
async function throughChatTransform(frames: string[]): Promise<string> {
  const { Readable } = await import("node:stream");
  const { reasoningToContentTransform } = await import("../src/daemon/server");
  const out: Buffer[] = [];
  const stream = Readable.from(frames.map((f) => Buffer.from(f))).pipe(reasoningToContentTransform());
  for await (const c of stream) out.push(c as Buffer);
  return Buffer.concat(out).toString("utf8");
}

async function renderAllProtocols(upstream: Array<Record<string, unknown>>) {
  const chatWire = await throughChatTransform([
    ...upstream.map((d) => sseData(chatChunk(d))),
    "data: [DONE]\n\n",
  ]);

  const anth = new AnthropicStreamEncoder();
  const anthropicWire = [
    ...upstream.flatMap((d) => anth.push(chatChunk(d), "test-model")),
    ...anth.close(),
  ].join("");

  const resp = new ResponsesStreamEncoder();
  const responsesWire = [
    ...resp.open("test-model"),
    ...upstream.flatMap((d) => resp.push(chatChunk(d))),
    ...resp.close(),
  ].join("");

  return {
    chat: renderInPlayground(chatWire, "chat"),
    anthropic: renderInPlayground(anthropicWire, "anthropic"),
    responses: renderInPlayground(responsesWire, "responses"),
  };
}

test("all three protocols render the same answer, with reasoning kept separate", async () => {
  const out = await renderAllProtocols([
    { role: "assistant", reasoning_content: "thinking hard" },
    { content: "final answer" },
  ]);

  for (const [protocol, got] of Object.entries(out)) {
    assert.equal(got.content, "final answer", `${protocol} answer`);
    assert.equal(got.reasoning, "thinking hard", `${protocol} reasoning`);
  }
});

test("a reasoning-only model still produces an answer on all three protocols", async () => {
  // the C5 guarantee: such a model used to render as an empty reply
  const out = await renderAllProtocols([
    { role: "assistant", reasoning_content: "all I have is this" },
  ]);

  for (const [protocol, got] of Object.entries(out)) {
    assert.equal(got.content, "all I have is this", `${protocol} falls back to reasoning`);
  }
});
