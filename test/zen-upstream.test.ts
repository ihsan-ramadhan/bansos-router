import test from "node:test";
import assert from "node:assert/strict";
import { zenUpstream, ZEN_MODELS } from "../src/upstreams/zen";

test("zenUpstream requestHeaders generates valid OpenCode v2 spoofing headers", () => {
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
  const paidModel = { ...model, id: "big-pickle" };
  const body2 = zenUpstream.transformRequestBody!({
    model: paidModel.id,
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "grep" } }],
    tool_choice: "auto",
  }, paidModel);

  // caller's tool_choice is preserved
  assert.equal(body2.tool_choice, "auto");
  const tools2 = body2.tools as Array<{ type: string; function: { name: string } }>;
  const names2 = tools2.map((t) => t.function.name);
  assert.ok(names2.includes("grep"));
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
  const responses = { ...ZEN_MODELS.find((m) => m.wireApi === "responses")!, id: "big-pickle" };
  const out = zenUpstream.transformRequestBody!(
    { model: "x", messages: [], tool_choice: "auto", tools: [{ type: "function", name: "grep" }] },
    responses,
  );
  assert.equal(out.tool_choice, "auto");
  assert.ok((out.tools as unknown[]).some((t: any) => t?.name === "grep"), "caller tool kept");
});
test("a tool outside opencode's vocabulary is dropped, not the whole set", () => {
  const model = ZEN_MODELS.find((m) => m.id.endsWith("-free") && m.wireApi !== "responses")!;
  const body = {
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { type: "function", function: { name: "bash", description: "run", parameters: { type: "object" } } },
      { type: "function", function: { name: "create_goal", description: "goal", parameters: { type: "object" } } },
    ],
  };
  const out = zenUpstream.transformRequestBody!(body, model);
  const names = (out.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
  // only the tool the gate would 429 on leaves; the caller's own tools keep their schemas
  assert.deepEqual(names, ["bash", "read", "shell"]);
  assert.equal((body.tools as unknown[]).length, 2, "the caller's tools array is untouched");

  // a caller that stays inside the vocabulary keeps every tool it declared
  const familiar = {
    ...body,
    tools: [
      { type: "function", function: { name: "bash", description: "run", parameters: { type: "object" } } },
      { type: "function", function: { name: "grep", description: "search", parameters: { type: "object" } } },
    ],
  };
  const kept = zenUpstream.transformRequestBody!(familiar, model);
  const keptNames = (kept.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
  assert.ok(keptNames.includes("bash"));
  assert.ok(keptNames.includes("grep"));
});

test("a caller read keeps its own schema once the foreign tool is gone", () => {
  const model = ZEN_MODELS.find((m) => m.id.endsWith("-free") && m.wireApi !== "responses")!;
  const body = {
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        type: "function",
        function: {
          name: "read",
          description: "read a file",
          parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
        },
      },
      { type: "function", function: { name: "mcp", description: "mcp", parameters: { type: "object" } } },
    ],
  };
  const out = zenUpstream.transformRequestBody!(body, model);
  const tools = out.tools as Array<{
    function: { name: string; description?: string; parameters: { properties: Record<string, unknown> } };
  }>;
  assert.ok(!tools.some((t) => t.function.name === "mcp"), "the foreign tool is dropped");
  // the caller's description survives, so the tool is theirs and not the fingerprint pair
  const read = tools.find((t) => t.function.name === "read")!;
  assert.equal(read.function.description, "read a file");
  // file_path is renamed because the gate 429s it; filePath is what the model is shown
  assert.deepEqual(Object.keys(read.function.parameters.properties), ["filePath"]);
});

test("a caller that declares only foreign tools still gets the fingerprint pair", () => {
  const model = ZEN_MODELS.find((m) => m.id.endsWith("-free") && m.wireApi !== "responses")!;
  const body = {
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { type: "function", function: { name: "mcp", description: "mcp", parameters: { type: "object" } } },
      { type: "function", function: { name: "agentgrep", description: "grep", parameters: { type: "object" } } },
    ],
  };
  const out = zenUpstream.transformRequestBody!(body, model);
  const names = (out.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
  assert.deepEqual(names, ["read", "shell"], "no tools at all would be worse than the fingerprint pair");
});

test("retryShape narrows any tool set to the pair, and reports null when it already is", () => {
  const model = ZEN_MODELS[0]!;
  const body = {
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { type: "function", function: { name: "edit", description: "Edit an existing UTF-8 text file", parameters: { type: "object" } } },
    ],
  };
  const shaped = zenUpstream.retryShape!(body, model)!;
  const names = (shaped.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
  assert.deepEqual(names, ["read", "shell"]);
  assert.equal((body.tools as unknown[]).length, 1, "the original body is untouched");

  // already the pair -> nothing left to change
  assert.equal(zenUpstream.retryShape!(shaped, model), null);
  // no tools at all -> nothing to reshape
  assert.equal(zenUpstream.retryShape!({ model: model.id, messages: [] }, model), null);
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

test("a caller edit tool without opencode's filePath is advertised as apply_edit (gate 429s it otherwise)", () => {
  const model = { ...ZEN_MODELS.find((m) => m.wireApi !== "responses")!, id: "big-pickle" };
  const snake = {
    type: "function",
    function: {
      name: "edit",
      description: "edit a file",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  };
  const body = { model: model.id, messages: [{ role: "user", content: "hi" }], tools: [snake] };
  const out = zenUpstream.transformRequestBody!(body, model);
  const names = (out.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
  assert.ok(names.includes("apply_edit"), "the caller's edit is advertised under the alias");
  assert.ok(!names.includes("edit"), "no bare edit tool reaches the gate");
  assert.equal(snake.function.name, "edit", "the caller's tool object is not mutated");

  const opencodeLike = {
    type: "function",
    function: {
      name: "edit",
      description: "edit a file",
      parameters: { type: "object", properties: { filePath: { type: "string" }, oldString: { type: "string" } } },
    },
  };
  const kept = zenUpstream.transformRequestBody!(
    { model: model.id, messages: [{ role: "user", content: "hi" }], tools: [opencodeLike] },
    model,
  );
  const keptNames = (kept.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
  assert.ok(keptNames.includes("edit"), "a filePath-shaped edit is left alone");
});

test("a system prompt sent as content parts keeps every part and gains the env block", () => {
  const model = ZEN_MODELS.find((m) => m.wireApi !== "responses")!;
  const body = {
    model: model.id,
    messages: [
      { role: "system", content: [{ type: "text", text: "You are a pirate." }] },
      { role: "user", content: "hi" },
    ],
  };
  const out = zenUpstream.transformRequestBody!(body, model);
  const system = (out.messages as any[])[0];
  assert.ok(Array.isArray(system.content), "content stays an array");
  assert.equal(system.content[0].text, "You are a pirate.", "the caller's prompt is not replaced");
  assert.ok(system.content.some((p: any) => p.text.includes("</env>")), "the env block is appended");
});

test("a caller read with file_path is advertised as filePath, which the gate accepts", () => {
  const model = ZEN_MODELS.find((m) => m.id.endsWith("-free") && m.wireApi !== "responses")!;
  const body = {
    model: model.id,
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        type: "function",
        function: {
          name: "read",
          description: "read",
          parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
        },
      },
      { type: "function", function: { name: "mcp", description: "mcp", parameters: { type: "object" } } },
    ],
  };
  const out = zenUpstream.transformRequestBody!(body, model);
  const tools = out.tools as Array<{ function: { name: string; parameters: { properties: Record<string, unknown>; required?: string[] } } }>;
  const read = tools.find((t) => t.function.name === "read")!;
  assert.deepEqual(Object.keys(read.function.parameters.properties), ["filePath"]);
  assert.deepEqual(read.function.parameters.required, ["filePath"]);
  assert.equal((body.tools as Array<{ function: { parameters: { properties: Record<string, unknown> } } }>)[0]!.function.parameters.properties.file_path !== undefined, true, "caller body untouched");
});

test("a caller read already using path or filePath is left alone", () => {
  const model = ZEN_MODELS.find((m) => m.id.endsWith("-free") && m.wireApi !== "responses")!;
  for (const key of ["path", "filePath"]) {
    const body = {
      model: model.id,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read",
            description: "read",
            parameters: { type: "object", properties: { [key]: { type: "string" } }, required: [key] },
          },
        },
      ],
    };
    const out = zenUpstream.transformRequestBody!(body, model);
    const read = (out.tools as Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>).find(
      (t) => t.function.name === "read",
    )!;
    assert.deepEqual(Object.keys(read.function.parameters.properties), [key], `${key} must not be renamed`);
  }
});
