import test from "node:test";
import assert from "node:assert/strict";
import { parseAnthropicRequest } from "../src/protocols/anthropic";

test("separate text blocks keep a boundary instead of gluing words together", () => {
  const r = parseAnthropicRequest({
    model: "m",
    max_tokens: 10,
    system: [{ type: "text", text: "You are a helper." }, { type: "text", text: "Be brief." }],
    messages: [{ role: "user", content: [{ type: "text", text: "<reminder>x</reminder>" }, { type: "text", text: "fix it" }] }],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const messages = r.value.chatBody.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0]!.content, "You are a helper.\n\nBe brief.");
  assert.equal(messages[1]!.content, "<reminder>x</reminder>\n\nfix it");
});

test("tool results follow their tool_use and keep the error flag", () => {
  const r = parseAnthropicRequest({
    model: "m",
    max_tokens: 10,
    messages: [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "a", name: "read", input: { path: "x" } },
          { type: "tool_use", id: "b", name: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "data" },
          { type: "tool_result", tool_use_id: "b", is_error: true, content: [{ type: "text", text: "denied" }] },
          { type: "text", text: "continue" },
        ],
      },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const messages = r.value.chatBody.messages as Array<Record<string, any>>;
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "tool", "tool", "user"]);
  assert.equal(messages[1]!.tool_calls.length, 2);
  assert.equal(messages[3]!.content, "Error: denied");
});

test("anthropic stream hides undeclared tools without promoting the planning to text", async () => {
  const { AnthropicStreamEncoder } = await import("../src/protocols/anthropic");
  const enc = new AnthropicStreamEncoder(new Set(["Read"]));
  const wire = [
    ...enc.push({ choices: [{ delta: { reasoning: "use shell" } }] }, "m"),
    ...enc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "z", function: { name: "shell", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }, "m"),
    ...enc.close(),
  ].join("");
  assert.doesNotMatch(wire, /tool_use/);
  assert.doesNotMatch(wire, /text_delta/);
  assert.match(wire, /"stop_reason":"end_turn"/);
});

test("thinking blocks travel back as reasoning_content on the assistant turn", () => {
  const r = parseAnthropicRequest({
    model: "m",
    max_tokens: 10,
    messages: [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "need the file", signature: "" },
          { type: "tool_use", id: "a", name: "read", input: { path: "x" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "data" }] },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const messages = r.value.chatBody.messages as Array<Record<string, any>>;
  assert.equal(messages[1]!.reasoning_content, "need the file");
  assert.equal(messages[1]!.content, null);
  assert.equal("reasoning_content" in messages[0]!, false);
});

test("an assistant turn with no thinking still carries an empty reasoning_content", () => {
  const r = parseAnthropicRequest({
    model: "m",
    max_tokens: 10,
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "data" }] },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const messages = r.value.chatBody.messages as Array<Record<string, any>>;
  assert.deepEqual(messages.filter((m) => m.role === "assistant").map((m) => m.reasoning_content), ["", ""]);
});
