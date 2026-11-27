import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { budgetExhaustedFrame, reasoningToContentTransform } from "../src/daemon/server";

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function run(frames: string[]): Promise<string> {
  const out: string[] = [];
  const tx = reasoningToContentTransform();
  const stream = Readable.from(frames).pipe(tx);
  for await (const chunk of stream) out.push(String(chunk));
  return out.join("");
}

const reasoningOnly = [
  frame({ id: "gen-1", model: "hy4-flash-free", choices: [{ index: 0, delta: { role: "assistant", reasoning: "thinking" } }] }),
  frame({ id: "gen-1", model: "hy4-flash-free", choices: [{ index: 0, delta: { role: "assistant", reasoning: " harder" } }] }),
];

test("a reasoning-only stream that hit the budget reports why, instead of folding a cut thought", async () => {
  const out = await run([
    ...reasoningOnly,
    frame({ id: "gen-1", model: "hy4-flash-free", choices: [{ index: 0, finish_reason: "length", delta: { role: "assistant", content: "" } }] }),
    "data: [DONE]\n\n",
  ]);
  assert.match(out, /reasoning_budget_exhausted/, "the caller is told the answer never started");
  assert.doesNotMatch(out, /"content":"thinking harder"/, "the truncated thought is not passed off as the answer");
});

test("the budget-exhausted frame names the model and the way out", () => {
  const body = budgetExhaustedFrame({ reasoning: "x".repeat(120), envelope: { id: "gen-1", model: "hy4-flash-free" } });
  assert.match(body, /hy4-flash-free/);
  assert.match(body, /raise max_tokens/);
  assert.match(body, /120 reasoning characters/);
});

test("a reasoning-only stream that stopped on its own is folded into content", async () => {
  const out = await run([
    ...reasoningOnly,
    frame({ id: "gen-1", model: "hy4-flash-free", choices: [{ index: 0, finish_reason: "stop", delta: { role: "assistant", content: "" } }] }),
    "data: [DONE]\n\n",
  ]);
  assert.match(out, /"content":"thinking harder"/, "the caller gets the only text the model produced");
  assert.doesNotMatch(out, /reasoning_budget_exhausted/);
});

test("a stream that already produced content is never folded", async () => {
  const out = await run([
    frame({ id: "gen-2", model: "big-pickle", choices: [{ index: 0, delta: { role: "assistant", content: "answer" } }] }),
    frame({ id: "gen-2", model: "big-pickle", choices: [{ index: 0, finish_reason: "length", delta: { role: "assistant", content: "" } }] }),
    "data: [DONE]\n\n",
  ]);
  assert.doesNotMatch(out, /reasoning_budget_exhausted/, "a cut answer is still an answer");
  assert.match(out, /"content":"answer"/);
});
