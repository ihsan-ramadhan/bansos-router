import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshZenIdentity, zenUpstream, ZEN_MODELS } from "../src/upstreams/zen";

// point the opencode DB lookup at an empty home so the machine's own opencode identity never leaks in
async function withEmptyHome(fn: () => void | Promise<void>): Promise<void> {
  const keys = ["HOME", "USERPROFILE", "LOCALAPPDATA"] as const;
  const saved = keys.map((k) => process.env[k]);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-home-"));
  for (const k of keys) process.env[k] = home;
  try {
    await fn();
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("zenUpstream requestHeaders generates valid OpenCode v2 spoofing headers", () => withEmptyHome(async () => {
  // settle the DB lookup first (finds nothing), so the headers use the synthetic identity deterministically
  await refreshZenIdentity();
  const model = ZEN_MODELS[0]!;
  const headers = zenUpstream.requestHeaders(model);

  assert.equal(headers["authorization"], "Bearer public");
  assert.ok(headers["User-Agent"]?.startsWith("opencode/"));
  assert.equal(headers["x-opencode-client"], "cli");

  const ses = headers["x-opencode-session"];
  assert.ok(ses, "x-opencode-session must exist");
  assert.match(ses, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/, "session ID must follow OpenCode descending format");
  assert.equal(headers["x-session-affinity"], ses);
  assert.equal(headers["x-opencode-session-id"], ses);

  assert.match(headers["x-opencode-project"] ?? "", /^[0-9a-f]{40}$/);
  assert.ok(headers["b3"]);
  assert.ok(headers["traceparent"]);
}));

test("caller opencode session headers win, and the background identity refresh never throws", async () => {
  const model = ZEN_MODELS[0]!;
  const caller = {
    "x-opencode-session": "ses_0123456789abABCDEFGHIJKLMN",
    "x-opencode-project": "0123456789abcdef0123456789abcdef01234567",
  };
  for (let i = 0; i < 2; i++) {
    const headers = zenUpstream.requestHeaders(model, caller);
    assert.equal(headers["x-opencode-session"], caller["x-opencode-session"]);
    assert.equal(headers["x-opencode-project"], caller["x-opencode-project"]);
  }
  await refreshZenIdentity();
});

test("zenUpstream transformRequestBody enforces streaming and injects required tools for chat wire", () => {
  const model = ZEN_MODELS.find((m) => m.wireApi !== "responses")!;

  // no tools provided -> inject read + shell
  const body1 = zenUpstream.transformRequestBody!({
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    stream: false,
  }, model);

  assert.equal(body1.stream, true, "must force stream: true for Zen gateway gate");
  // tool_choice is not set by the transform (upstream handles it)
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

  // caller's tool_choice is preserved
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

test("spoof tools are injected on both chat and responses wire", () => {
  const chat = ZEN_MODELS.find((m) => m.wireApi !== "responses")!;
  const responses = ZEN_MODELS.find((m) => m.wireApi === "responses")!;
  const body = { model: "x", messages: [{ role: "user", content: "hi" }] };

  const onChat = zenUpstream.transformRequestBody!(body, chat);
  assert.ok(Array.isArray(onChat.tools) && onChat.tools.length > 0);

  const onResponses = zenUpstream.transformRequestBody!(body, responses);
  assert.ok(Array.isArray(onResponses.tools) && onResponses.tools.length > 0);
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
test("a caller's read/shell satisfy the gate and are never renamed or leaked", () => {
  const model = ZEN_MODELS.find((m) => m.wireApi !== "responses")!;
  const out = zenUpstream.transformRequestBody!(
    {
      model: model.id,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read", description: "x", parameters: { type: "object" } } }],
    },
    model,
  );
  assert.equal("__bansosToolAliases" in out, false, "strict upstreams 400 on unknown body fields");
  const names = (out.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
  assert.ok(!names.some((n) => n.endsWith("_pi")), "the caller's tools are never renamed");
  assert.equal(names.filter((n) => n === "read").length, 1, "the caller's read is kept, not duplicated");
  assert.ok(names.includes("shell"), "the missing fingerprint tool is added");
});

test("fingerprint injection never leaks into the caller's own body", () => {
  for (const model of [ZEN_MODELS.find((m) => m.wireApi !== "responses")!, ZEN_MODELS.find((m) => m.wireApi === "responses")!]) {
    const tools = [{ type: "function", function: { name: "exec_command", parameters: { type: "object" } } }];
    const body = { model: model.id, messages: [{ role: "user", content: "hi" }], tools };
    const out = zenUpstream.transformRequestBody!(body, model);
    assert.equal(tools.length, 1, "caller's tools array untouched");
    assert.ok((out.tools as unknown[]).length > 1);
  }
});
