import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createSseFrameSplitter } from "../src/protocols/stream";
import { filterInjectedToolCallsTransform, reasoningToContentTransform, streamToChatResponse } from "../src/daemon/server";

const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

async function pipe(chunks: Buffer[], transform: import("node:stream").Transform): Promise<string> {
  const out: Buffer[] = [];
  for await (const c of Readable.from(chunks).pipe(transform)) out.push(c as Buffer);
  return Buffer.concat(out).toString("utf8");
}

test("a multibyte character split across chunks survives both chat transforms", async () => {
  const bytes = Buffer.from(frame("héllo → 世界") + "data: [DONE]\n\n", "utf8");
  const cut = bytes.indexOf(Buffer.from("→")) + 1;
  for (const make of [() => filterInjectedToolCallsTransform(new Set()), reasoningToContentTransform]) {
    const text = await pipe([bytes.subarray(0, cut), bytes.subarray(cut)], make());
    assert.ok(text.includes("héllo → 世界"), text);
    assert.ok(!text.includes("�"));
  }
});

test("CRLF-delimited events are emitted as they arrive, not at stream end", () => {
  const splitter = createSseFrameSplitter();
  assert.equal(splitter.push(Buffer.from("data: {}\r\n\r")).length, 0);
  assert.deepEqual(splitter.push(Buffer.from("\ndata: [DONE]\r\n\r\n")), ["data: {}\n\n", "data: [DONE]\n\n"]);
});

test("the non-stream fold keeps reasoning_content and frames without a space after data:", async () => {
  const sse = `data:${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] })}\n\ndata:${JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  const json = (await (await streamToChatResponse(new Response(sse), "m")).json()) as any;
  assert.equal(json.choices[0].message.content, "hi");
  assert.equal(json.choices[0].message.reasoning, "thinking");
});

test("reasoning is folded before the finish frame and never when tools were called", async () => {
  const f = (choice: Record<string, unknown>) => `data: ${JSON.stringify({ id: "x", choices: [{ index: 0, ...choice }] })}\n\n`;
  const thinkOnly = await pipe(
    [Buffer.from(f({ delta: { reasoning_content: "42" } }) + f({ delta: {}, finish_reason: "stop" }) + "data: [DONE]\n\n")],
    reasoningToContentTransform(),
  );
  const order = thinkOnly.split("\n\n").filter(Boolean);
  assert.match(order[1]!, /"content":"42"/, "fold lands before the finish frame");
  assert.match(order[2]!, /"finish_reason":"stop"/);

  const withTool = await pipe(
    [Buffer.from(
      f({ delta: { reasoning_content: "use read" } }) +
      f({ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "read", arguments: "{}" } }] } }) +
      f({ delta: {}, finish_reason: "tool_calls" }) + "data: [DONE]\n\n",
    )],
    reasoningToContentTransform(),
  );
  assert.doesNotMatch(withTool, /"content":"use read"/);
});
