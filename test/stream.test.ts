import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import { readSseStream, sseData, sseDone, sseEvent } from "../src/protocols/stream";
import { AnthropicStreamEncoder } from "../src/protocols/anthropic";

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

test("sseData / sseEvent / sseDone produce the documented frames", () => {
  assert.equal(sseData({ a: 1 }), 'data: {"a":1}\n\n');
  assert.equal(sseEvent("ping", { x: 2 }), 'event: ping\ndata: {"x":2}\n\n');
  assert.equal(sseDone(), "data: [DONE]\n\n");
});

test("readSseStream parses OpenAI-style data-only frames", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf('data: {"i":1}\n\ndata: [DONE]\n\n'))) {
    chunks.push(c);
  }
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.event, undefined);
  assert.equal(chunks[0]?.data, '{"i":1}');
  assert.equal(chunks[1]?.data, "[DONE]");
});

test("readSseStream parses Anthropic-style event + data frames", async () => {
  const chunks = [];
  for await (const c of readSseStream(
    streamOf('event: message_start\ndata: {"type":"message_start"}\n\nevent: ping\ndata: {"type":"ping"}\n\n'),
  )) {
    chunks.push(c);
  }
  assert.equal(chunks[0]?.event, "message_start");
  assert.equal(chunks[0]?.data, '{"type":"message_start"}');
  assert.equal(chunks[1]?.event, "ping");
});

test("readSseStream accumulates multi-line data values", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf("data: line1\ndata: line2\n\n"))) {
    chunks.push(c);
  }
  assert.equal(chunks[0]?.data, "line1\nline2");
});

test("readSseStream flushes a trailing frame without blank line", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf('data: {"done":true}\n'))) {
    chunks.push(c);
  }
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.data, '{"done":true}');
});

test("readSseStream handles CRLF and comment lines", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf(': keepalive\r\ndata: {"ok":1}\r\n\r\n'))) {
    chunks.push(c);
  }
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.data, '{"ok":1}');
});

interface ParsedEvent {
  type: string;
  data: any;
}

function parseEvents(frames: string[]): ParsedEvent[] {
  return frames
    .join("")
    .split("\n\n")
    .filter((f) => f.startsWith("event: "))
    .map((f) => {
      const nl = f.indexOf("\n");
      const type = f.slice("event: ".length, nl);
      const raw = f.slice(nl + 1).replace(/^data: /, "");
      let data: any = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // leave as raw text
      }
      return { type, data };
    });
}

test("AnthropicStreamEncoder closes the thinking block before starting tool_use", () => {
  const encoder = new AnthropicStreamEncoder();
  const out: string[] = [];
  out.push(...encoder.push(
    { id: "c1", choices: [{ index: 0, delta: { reasoning: "let me think" } }] },
    "test-model",
  ));
  out.push(...encoder.push(
    {
      id: "c1",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "run", arguments: "{}" } }] },
      }],
    },
    "test-model",
  ));
  out.push(...encoder.close());

  const events = parseEvents(out);
  const thinkingStart = events.find(
    (e) => e.type === "content_block_start" && e.data?.content_block?.type === "thinking",
  );
  assert.ok(thinkingStart, "a thinking block must be started");
  const thinkingIndex = (thinkingStart as ParsedEvent).data.index;
  const thinkingStopPos = events.findIndex(
    (e) => e.type === "content_block_stop" && e.data?.index === thinkingIndex,
  );
  const toolStartPos = events.findIndex(
    (e) => e.type === "content_block_start" && e.data?.content_block?.type === "tool_use",
  );
  const toolDeltaPos = events.findIndex(
    (e) => e.type === "content_block_delta" && e.data?.delta?.type === "input_json_delta",
  );
  assert.ok(toolStartPos !== -1 && toolDeltaPos !== -1);
  assert.ok(thinkingStopPos !== -1, "open thinking block must be stopped when tool calls begin");
  assert.ok(
    thinkingStopPos < toolStartPos && thinkingStopPos < toolDeltaPos,
    `expected thinking stop (${thinkingStopPos}) before tool_use start (${toolStartPos}) and deltas (${toolDeltaPos})`,
  );
});

test("AnthropicStreamEncoder emits message_stop exactly once with [DONE]-less streams", () => {
  const encoder = new AnthropicStreamEncoder();
  const out: string[] = [];
  out.push(...encoder.push({ id: "c1", choices: [{ index: 0, delta: { content: "hi" } }] }, "m"));
  out.push(...encoder.close());
  const types = parseEvents(out).map((e) => e.type);
  assert.equal(types.filter((t) => t === "message_stop").length, 1);
  assert.equal(types[types.length - 1], "message_stop");
});
