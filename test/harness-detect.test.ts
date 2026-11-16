import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { detectHarness } from "../src/daemon/server";

const req = (headers: Record<string, string>): IncomingMessage => ({ headers }) as IncomingMessage;

test("a client that names itself claims the label", () => {
  assert.equal(detectHarness(req({ "user-agent": "Mozilla/5.0", "x-bansos-client": "dashboard" })), "dashboard");
  assert.equal(detectHarness(req({ "x-bansos-client": "DeepSeek" })), "deepseek");
});

test("a malformed client header falls back to the UA", () => {
  assert.equal(detectHarness(req({ "user-agent": "curl/8.5.0", "x-bansos-client": "not a label!" })), "curl");
  assert.equal(detectHarness(req({ "x-bansos-client": "x".repeat(40) })), "gateway");
});

test("harness user agents keep their own label", () => {
  assert.equal(detectHarness(req({ "user-agent": "pi/0.9.1" })), "pi");
  assert.equal(detectHarness(req({ "user-agent": "oh-my-pi/0.2" })), "omp");
  assert.equal(detectHarness(req({ "user-agent": "claude-cli/2.0.1" })), "claude-code");
  assert.equal(detectHarness(req({ "user-agent": "opencode/1.2.3" })), "opencode");
  assert.equal(detectHarness(req({ "user-agent": "codex-cli/0.9" })), "codex");
  assert.equal(detectHarness(req({ "user-agent": "deepseek-harness/0.1.0" })), "dsh");
});

test("a gateway or bare runtime is never called pi", () => {
  assert.equal(detectHarness(req({})), "gateway");
  assert.equal(detectHarness(req({ "user-agent": "undici" })), "gateway");
  assert.equal(detectHarness(req({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0" })), "gateway");
  assert.equal(detectHarness(req({ "user-agent": "node" })), "gateway");
});

test("gateways and scripts that do announce themselves keep their name", () => {
  assert.equal(detectHarness(req({ "user-agent": "9router/0.5.119" })), "9router");
  assert.equal(detectHarness(req({ "user-agent": "litellm/1.60" })), "litellm");
  assert.equal(detectHarness(req({ "user-agent": "curl/8.5.0" })), "curl");
});
