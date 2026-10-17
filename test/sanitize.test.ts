import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeChatBody } from "../src/protocols/openai-chat";

test("sanitizeChatBody rewrites developer role to system when unsupported", () => {
  const input = {
    model: "deepseek-v4-flash-free",
    messages: [
      { role: "developer", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ],
  };

  const output = sanitizeChatBody(input, false);
  assert.deepEqual(output.messages, [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello" },
  ]);
});

test("sanitizeChatBody leaves messages intact when developer role is supported", () => {
  const input = {
    model: "gpt-4o",
    messages: [
      { role: "developer", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ],
  };

  const output = sanitizeChatBody(input, true);
  assert.equal(output, input);
});

test("sanitizeChatBody strips vLLM/OMP thinking controls that strict upstreams reject", () => {
  const input = {
    model: "ovh/Qwen3.5-397B-A17B",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 16,
    preserve_thinking: true,
    chat_template_kwargs: { preserve_thinking: true },
    enable_thinking: true,
  };

  const output = sanitizeChatBody(input, true);
  assert.equal("preserve_thinking" in output, false);
  assert.equal("chat_template_kwargs" in output, false);
  assert.equal("enable_thinking" in output, false);
  assert.deepEqual(output.messages, input.messages, "messages untouched");
  assert.equal(output.max_tokens, 16, "standard fields survive");
  assert.deepEqual(input.messages, [{ role: "user", content: "hello" }], "input not mutated");
  assert.equal("preserve_thinking" in input, true, "input not mutated");
});

test("sanitizeChatBody is a no-op passthrough for a clean body", () => {
  const input = {
    model: "ovh/Qwen3.5-397B-A17B",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 16,
  };
  assert.equal(sanitizeChatBody(input, true), input, "same reference when nothing to strip");
});
