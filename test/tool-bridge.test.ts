import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { callerToolsFromBody } from "../src/protocols/tool-bridge";
import { filterInjectedToolCallsTransform, streamToChatResponse } from "../src/daemon/server";
import { AnthropicStreamEncoder } from "../src/protocols/anthropic";
import { ResponsesStreamEncoder } from "../src/protocols/responses";

const fn = (name: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: "function",
  function: { name, parameters: { type: "object", properties, required } },
});

const claudeCode = { tools: [
  fn("Bash", { command: { type: "string" }, timeout: { type: "number" }, description: { type: "string" }, run_in_background: { type: "boolean" } }, ["command"]),
  fn("Read", { file_path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, ["file_path"]),
] };
const codex = { tools: [fn("exec_command", { cmd: { type: "string" }, workdir: { type: "string" } }, ["cmd"]), fn("view_image", { path: { type: "string" } }, ["path"])] };
const pi = { tools: [fn("read", { path: { type: "string" } }, ["path"]), fn("bash", { command: { type: "string" }, timeout: { type: "number" } }, ["command"])] };
const legacyShell = { tools: [fn("shell", { command: { type: "array" } }, ["command"])] };

const run = (body: unknown, name: string, args: unknown) => callerToolsFromBody(body).bridge?.(name)?.(JSON.stringify(args)) ?? null;

test("shell maps onto Claude Code's Bash and read onto its Read", () => {
  assert.deepEqual(run(claudeCode, "shell", { command: "ls", timeout: 5000, workdir: "/x" }), {
    name: "Bash",
    arguments: JSON.stringify({ command: "ls", timeout: 5000 }),
  });
  assert.deepEqual(run(claudeCode, "read", { path: "a.txt", offset: 3 }), {
    name: "Read",
    arguments: JSON.stringify({ file_path: "a.txt", offset: 3 }),
  });
});

test("Codex gets shell as exec_command and read as a quoted sed over its shell", () => {
  assert.deepEqual(run(codex, "shell", { command: "echo hi", workdir: "/w" }), {
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "echo hi", workdir: "/w" }),
  });
  const read = run(codex, "read", { path: "it's.txt", offset: 10, limit: 5 })!;
  assert.equal(read.name, "exec_command");
  assert.equal(JSON.parse(read.arguments).cmd, "sed -n '10,14p' -- 'it'\\''s.txt'");
  assert.ok(!JSON.stringify(read).includes("view_image"), "a path-taking tool is not mistaken for a reader");
});

test("a caller's own read/shell are never bridged, and an array command is wrapped", () => {
  assert.equal(callerToolsFromBody(pi).bridge?.("read"), null);
  assert.equal(run(pi, "shell", { command: "pwd" })!.name, "bash");
  assert.equal(callerToolsFromBody(legacyShell).bridge?.("shell"), null);
  const viaBash = run({ tools: [fn("run", {})] }, "shell", { command: "x" });
  assert.equal(viaBash, null, "no equivalent tool: the call stays hidden");
});

test("unmappable or malformed arguments fall back to hiding the call", () => {
  assert.equal(run(claudeCode, "shell", {}), null);
  assert.equal(callerToolsFromBody(claudeCode).bridge?.("shell")?.("{not json"), null);
  const strict = { tools: [fn("bash", { command: { type: "string" }, sandbox: { type: "string" } }, ["command", "sandbox"])] };
  assert.equal(run(strict, "shell", { command: "ls" }), null, "a required field we cannot fill blocks the mapping");
});

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c1", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const hiddenShell = [
  chunk({ tool_calls: [{ index: 0, id: "call_z", function: { name: "shell", arguments: "" } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '"ls -la"}' } }] }),
  chunk({}, "tool_calls"),
];

test("chat stream: a hidden shell call reaches the client as its own tool, before the finish frame", async () => {
  const out: Buffer[] = [];
  const tx = filterInjectedToolCallsTransform(callerToolsFromBody(claudeCode));
  for await (const c of Readable.from([...hiddenShell, "data: [DONE]\n\n"].map((f) => Buffer.from(f))).pipe(tx)) out.push(c as Buffer);
  const frames = Buffer.concat(out).toString("utf8").split("\n\n").filter(Boolean);
  const bridged = frames.findIndex((f) => f.includes('"name":"Bash"'));
  const finish = frames.findIndex((f) => f.includes('"finish_reason":"tool_calls"'));
  assert.ok(bridged !== -1 && bridged < finish, frames.join("\n"));
  assert.match(frames[bridged]!, /"arguments":"\{\\"command\\":\\"ls -la\\"\}"/);
  assert.match(frames[bridged]!, /"id":"call_z"/);
  assert.ok(!frames.some((f) => f.includes('"name":"shell"')));
});

test("non-stream fold, Anthropic and Responses all deliver the bridged call", async () => {
  const folded = (await (await streamToChatResponse(new Response(hiddenShell.join("") + "data: [DONE]\n\n"), "m", callerToolsFromBody(claudeCode))).json()) as any;
  assert.deepEqual(folded.choices[0].message.tool_calls[0].function, { name: "Bash", arguments: '{"command":"ls -la"}' });
  assert.equal(folded.choices[0].finish_reason, "tool_calls");

  const frames = hiddenShell.map((f) => JSON.parse(f.slice(6)));
  const anth = new AnthropicStreamEncoder(callerToolsFromBody(claudeCode));
  const anthWire = [...frames.flatMap((f) => anth.push(f, "m")), ...anth.close()].join("");
  assert.match(anthWire, /"type":"tool_use","id":"call_z","name":"Bash"/);
  assert.match(anthWire, /"stop_reason":"tool_use"/);

  const resp = new ResponsesStreamEncoder(callerToolsFromBody(codex));
  const respWire = [...resp.open("m"), ...frames.flatMap((f) => resp.push(f)), ...resp.close()].join("");
  const completed = JSON.parse(respWire.trim().split("\n\n").at(-1)!.split("\ndata: ")[1]!);
  assert.deepEqual(completed.response.output.map((o: any) => [o.type, o.name, o.call_id]), [["function_call", "exec_command", "call_z"]]);
  assert.equal(completed.response.output[0].arguments, '{"cmd":"ls -la"}');
});

test("required intent-style fields (OMP's `i`) are filled, other unknown required fields still block", () => {
  const omp = { tools: [fn("bash", { command: { type: "string" }, i: { type: "string" } }, ["command", "i"])] };
  const out = JSON.parse(run(omp, "shell", { command: "echo e2e-ok > done.txt" })!.arguments);
  assert.deepEqual(out, { command: "echo e2e-ok > done.txt", i: "Run echo e2e-ok > done.txt" });
  const odd = { tools: [fn("bash", { command: { type: "string" }, session: { type: "string" } }, ["command", "session"])] };
  assert.equal(run(odd, "shell", { command: "ls" }), null);
});

test("history sent back to Zen shows the model the call it really made; other upstreams see the caller's", async () => {
  const { restoreBridgedCalls } = await import("../src/protocols/tool-bridge");
  const { zenUpstream, ZEN_MODELS } = await import("../src/upstreams/zen");
  const bridged = callerToolsFromBody(codex).bridge!("read")!('{"path":"notes.txt"}', "call_hist_1");
  assert.equal(bridged!.name, "exec_command");
  const history = [
    { role: "user", content: "go" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_hist_1", type: "function", function: bridged }] },
    { role: "tool", tool_call_id: "call_hist_1", content: "build number: 1" },
  ];
  const restored = restoreBridgedCalls(history) as any[];
  assert.deepEqual(restored[1].tool_calls[0].function, { name: "read", arguments: '{"path":"notes.txt"}' });
  assert.equal((history[1] as any).tool_calls[0].function.name, "exec_command", "the caller's copy is untouched");

  const model = ZEN_MODELS.find((m) => m.wireApi !== "responses")!;
  const out = zenUpstream.transformRequestBody!({ model: model.id, messages: history, tools: codex.tools }, model) as any;
  assert.equal(out.messages[1].tool_calls[0].function.name, "read");
});
