import test from "node:test";
import assert from "node:assert/strict";
import { zenUpstream, ZEN_MODELS } from "../src/upstreams/zen";

test("zenUpstream requestHeaders generates valid OpenCode v2 spoofing headers", () => {
  const model = ZEN_MODELS[0]!;
  const headers = zenUpstream.requestHeaders(model);

  assert.equal(headers["authorization"], "Bearer public");
  assert.equal(headers["User-Agent"], "opencode/latest/2.0.5/cli");
  assert.equal(headers["x-opencode-client"], "cli");

  const ses = headers["x-opencode-session"];
  assert.ok(ses, "x-opencode-session must exist");
  assert.match(ses, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/, "session ID must follow OpenCode descending format");
  assert.equal(headers["x-session-affinity"], ses);
  assert.equal(headers["x-session-id"], ses);

  assert.match(headers["x-opencode-project"] ?? "", /^[0-9a-f]{40}$/);
  assert.ok(headers["b3"]);
  assert.ok(headers["traceparent"]);
});

test("zenUpstream transformRequestBody enforces streaming and injects required tools for chat wire", () => {
  const model = ZEN_MODELS.find((m) => m.wireApi !== "responses")!;

  // no tools provided -> inject read + shell with tool_choice: none
  const body1 = zenUpstream.transformRequestBody!({
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    stream: false,
  }, model);

  assert.equal(body1.stream, true, "must force stream: true for Zen gateway gate");
  assert.equal(body1.tool_choice, "none");
  const tools1 = body1.tools as Array<{ type: string; function: { name: string } }>;
  assert.ok(Array.isArray(tools1));
  const names1 = tools1.map((t) => t.function.name);
  assert.ok(names1.includes("read"));
  assert.ok(names1.includes("shell"));

  // client already has custom tools -> keep them and ensure read + shell are present
  const body2 = zenUpstream.transformRequestBody!({
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "custom_tool" } }],
    tool_choice: "auto",
  }, model);

  assert.equal(body2.tool_choice, "auto");
  const tools2 = body2.tools as Array<{ type: string; function: { name: string } }>;
  const names2 = tools2.map((t) => t.function.name);
  assert.ok(names2.includes("custom_tool"));
  assert.ok(names2.includes("read"));
  assert.ok(names2.includes("shell"));
});

test("zenUpstream transformRequestBody handles responses wire models", () => {
  const model = ZEN_MODELS.find((m) => m.wireApi === "responses")!;

  const body = zenUpstream.transformRequestBody!({
    model: model.id,
    input: "hi",
    stream: false,
  }, model);

  assert.equal(body.stream, true);
  const tools = body.tools as Array<{ type: string; name: string }>;
  assert.ok(Array.isArray(tools));
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("read"));
  assert.ok(names.includes("shell"));
});

test("spoof tools are parked with tool_choice on chat, but not on the responses wire", () => {
  const chat = ZEN_MODELS.find((m) => m.wireApi !== "responses")!;
  const responses = ZEN_MODELS.find((m) => m.wireApi === "responses")!;
  const body = { model: "x", messages: [{ role: "user", content: "hi" }] };

  const onChat = zenUpstream.transformRequestBody!(body, chat);
  assert.ok(Array.isArray(onChat.tools) && onChat.tools.length > 0);
  assert.equal(onChat.tool_choice, "none");

  const onResponses = zenUpstream.transformRequestBody!(body, responses);
  assert.ok(Array.isArray(onResponses.tools) && onResponses.tools.length > 0);
  assert.equal(onResponses.tool_choice, undefined);
});

test("a caller's own tool_choice survives tool injection", () => {
  const responses = ZEN_MODELS.find((m) => m.wireApi === "responses")!;
  const out = zenUpstream.transformRequestBody!(
    { model: "x", messages: [], tool_choice: "auto", tools: [{ type: "function", name: "grep" }] },
    responses,
  );
  assert.equal(out.tool_choice, "auto");
  assert.ok((out.tools as unknown[]).some((t: any) => t?.name === "grep"), "caller tool kept");
});
