import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Transform } from "node:stream";
import { extractUsage, logUsageTransform, reasoningToContentTransform } from "../src/daemon/server";
import type { Logger } from "../src/logger";

test("extractUsage returns input/output tokens from an openai usage object", () => {
  assert.deepEqual(
    extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    { inputTokens: 10, outputTokens: 5 },
  );
});

test("extractUsage returns null when usage is missing or partial", () => {
  assert.equal(extractUsage({ choices: [] }), null);
  assert.equal(extractUsage({ usage: { prompt_tokens: 3 } }), null);
  assert.equal(extractUsage(null), null);
});

test("logUsageTransform reports usage from the final streamed chunk and passes bytes through", async () => {
  const calls: Array<{ msg: string; fields: Record<string, unknown> }> = [];
  const log = {
    info: (msg: string, fields?: Record<string, unknown>) =>
      calls.push({ msg, fields: fields ?? {} }),
    debug: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  } as unknown as Logger;

  const source = Readable.from([
    Buffer.from('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
    Buffer.from(
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    ),
    Buffer.from("data: [DONE]\n\n"),
  ]);

  const chunks: Buffer[] = [];
  const sink = new Transform({
    transform(chunk, _enc, cb) {
      chunks.push(chunk as Buffer);
      cb();
    },
  });

  const startedAt = Date.now() - 100;
  await new Promise<void>((resolve, reject) => {
    source.pipe(logUsageTransform("deepseek-v4-flash-free", "zen", log, startedAt)).pipe(sink);
    sink.on("error", reject);
    sink.on("finish", () => {
      try {
        const full = Buffer.concat(chunks).toString("utf8");
        assert.ok(full.includes('"content":"hi"'), "content chunk passed through");
        assert.ok(full.includes("[DONE]"), "done frame passed through");
        assert.equal(calls.length, 1, "usage logged exactly once");
        const call = calls[0]!;
        assert.equal(call.msg, "chat done");
        assert.equal(call.fields.model, "deepseek-v4-flash-free");
        assert.equal(call.fields.upstream, "zen");
        assert.equal(call.fields.inputTokens, 10);
        assert.equal(call.fields.outputTokens, 5);
        assert.ok(
          typeof call.fields.durationMs === "number" && call.fields.durationMs >= 100,
          `durationMs >= 100 (got ${call.fields.durationMs})`,
        );
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
});

async function throughTransform(input: string[]): Promise<string> {
  const source = Readable.from(input.map((s) => Buffer.from(s, "utf8")));
  const chunks: Buffer[] = [];
  const sink = new Transform({
    transform(chunk, _enc, cb) {
      chunks.push(chunk as Buffer);
      cb();
    },
  });
  await new Promise<void>((resolve, reject) => {
    source.pipe(reasoningToContentTransform()).pipe(sink);
    sink.on("error", reject);
    sink.on("finish", () => {
      try {
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
  return Buffer.concat(chunks).toString("utf8");
}

test("reasoningToContentTransform folds reasoning-only deltas into content", async () => {
  const out = await throughTransform([
    'data: {"choices":[{"delta":{"reasoning_content":"thinking hard"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"final answer"}}]}\n\n',
    "data: [DONE]\n\n",
  ]);
  assert.ok(out.includes('"content":"thinking hard"'), "reasoning folded into content");
  assert.ok(!out.includes("reasoning_content"), "reasoning_content dropped from folded delta");
  assert.ok(out.includes('"content":"final answer"'), "real content delta untouched");
  assert.ok(out.includes("[DONE]"), "done frame untouched");
});

test("reasoningToContentTransform reassembles frames split across chunks", async () => {
  const frame = 'data: {"choices":[{"delta":{"reasoning_content":"split frame"}}]}\n\n';
  const out = await throughTransform([frame.slice(0, 20), frame.slice(20)]);
  assert.ok(out.includes('"content":"split frame"'), "split frame folded correctly");
  assert.equal(out, frame.replace("reasoning_content", "content"), "byte output equals folded frame");
});

test("reasoningToContentTransform leaves non-reasoning frames byte-identical", async () => {
  const frames = [
    'data: {"choices":[{"delta":{},"finish_reason":null}]}\n\n',
    'data: {"id":"x","choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const out = await throughTransform(frames);
  assert.equal(out, frames.join(""), "frames pass through unchanged");
});