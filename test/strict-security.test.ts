import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import { createLogger, type Logger } from "../src/logger";
import { runRelay } from "../src/cli/relay";
import { modelDef, type ModelDef, type Upstream } from "../src/upstreams/types";
import {
  assertBindAllowed,
  isLoopbackBind,
  normalizeSecurityConfig,
  type SecurityConfig,
} from "../src/security/policy";
import { scanRequestBody } from "../src/security/secret-guard";
import { DEFAULT_CONFIG } from "../src/daemon/state";

interface MockProvider {
  server: http.Server;
  url: string;
  hits: number;
  close(): Promise<void>;
}

function completionBody(): string {
  return JSON.stringify({
    id: "chatcmpl-local-test",
    choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  });
}

async function createMockProvider(
  status = 200,
  responseBody = completionBody(),
): Promise<MockProvider> {
  const mock: MockProvider = {
    server: http.createServer(async (req, res) => {
      mock.hits += 1;
      for await (const _chunk of req) {
        // Drain the request without retaining prompt or secret values.
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(responseBody);
    }),
    url: "",
    hits: 0,
    close: async () => {},
  };

  await new Promise<void>((resolve) => {
    mock.server.listen(0, "127.0.0.1", () => {
      const address = mock.server.address() as { port: number };
      mock.url = `http://127.0.0.1:${address.port}/chat/completions`;
      mock.close = () => new Promise<void>((done) => mock.server.close(() => done()));
      resolve();
    });
  });
  return mock;
}

function recordingLogger(entries: Array<Record<string, unknown>>): Logger {
  const add = (level: string, msg: string, fields?: Record<string, unknown>) => {
    entries.push({ level, msg, ...(fields ?? {}) });
  };
  return {
    debug: (msg, fields) => add("debug", msg, fields),
    info: (msg, fields) => add("info", msg, fields),
    warn: (msg, fields) => add("warn", msg, fields),
    error: (msg, fields) => add("error", msg, fields),
    child: () => recordingLogger(entries),
  };
}

function strictSecurity(allowedUpstreams: string[] = []): SecurityConfig {
  return normalizeSecurityConfig({
    mode: "strict",
    allowedUpstreams,
    allowCrossProviderFailover: true,
  });
}

function testModel(id: string, source: ModelDef["source"]): ModelDef {
  return modelDef({
    id,
    name: id,
    source,
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 4_096,
    input: ["text"],
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  });
}

function testUpstream(id: "zen" | "kilo", chatUrl: string): Upstream {
  return {
    id,
    kind: "remote-keyless",
    relayAllowed: true,
    chatUrl,
    async fetchCatalog() { return null; },
    requestHeaders() { return {}; },
  };
}

async function createTestDaemon(
  security: SecurityConfig,
  upstreams: Upstream[],
  models: ModelDef[],
  log: Logger = recordingLogger([]),
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const catalog = new RuntimeCatalog(upstreams, log, security);
  catalog.seed(models);
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 1_000, windowMs: 60_000 }),
    port: 0,
    log,
    startedAt: Date.now(),
    security,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function wireRequests(model: string, content: string): Array<{
  name: string;
  path: string;
  body: Record<string, unknown>;
}> {
  return [
    {
      name: "chat",
      path: "/v1/chat/completions",
      body: { model, messages: [{ role: "user", content }] },
    },
    {
      name: "responses",
      path: "/v1/responses",
      body: { model, input: [{ type: "function_call_output", call_id: "call_1", output: content }] },
    },
    {
      name: "anthropic",
      path: "/v1/messages",
      body: { model, max_tokens: 64, messages: [{ role: "user", content }] },
    },
  ];
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("strict config defaults are fail-closed while normal mode remains compatible", () => {
  const strict = normalizeSecurityConfig({ mode: "strict" });
  assert.deepEqual(strict.allowedUpstreams, []);
  assert.equal(strict.allowCrossProviderFailover, false);
  assert.equal(DEFAULT_CONFIG.bind, "127.0.0.1");

  const normal = normalizeSecurityConfig(undefined);
  assert.equal(normal.mode, "normal");
  assert.equal(normal.allowCrossProviderFailover, true);
});

test("strict bind policy accepts loopback and rejects non-loopback without unsafe override", () => {
  const strict = strictSecurity();
  for (const bind of ["127.0.0.1", "127.0.0.2", "localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackBind(bind), true, bind);
    assert.doesNotThrow(() => assertBindAllowed(bind, strict));
  }
  for (const bind of ["0.0.0.0", "::", "192.168.1.10", "example.internal"]) {
    assert.throws(() => assertBindAllowed(bind, strict), /strict security mode refuses/);
  }
  assert.doesNotThrow(() => assertBindAllowed("0.0.0.0", strict, true));
});

test("secret guard detects required credential classes and avoids common placeholders", () => {
  const openAi = ["sk", "proj", "A".repeat(24)].join("-");
  const anthropic = ["sk", "ant", "api03", "B".repeat(24)].join("-");
  const github = `github_pat_${"C".repeat(24)}`;
  const aws = `AKIA${"D".repeat(16)}`;
  const privateKey = "-----BEGIN PRIVATE KEY-----";
  const encryptedPrivateKey = "-----BEGIN ENCRYPTED PRIVATE KEY-----";
  const sshKey = "-----BEGIN OPENSSH PRIVATE KEY-----";

  assert.deepEqual(scanRequestBody(openAi).secretTypes, ["openai_api_key"]);
  assert.deepEqual(scanRequestBody(anthropic).secretTypes, ["anthropic_api_key"]);
  assert.deepEqual(scanRequestBody(github).secretTypes, ["github_pat"]);
  assert.deepEqual(scanRequestBody(aws).secretTypes, ["aws_access_key"]);
  assert.deepEqual(scanRequestBody(privateKey).secretTypes, ["private_key"]);
  assert.deepEqual(scanRequestBody(encryptedPrivateKey).secretTypes, ["private_key"]);
  assert.deepEqual(scanRequestBody(sshKey).secretTypes, ["ssh_private_key"]);
  assert.equal(scanRequestBody("password = Sup3rSyntheticValue").blocked, true);
  assert.equal(scanRequestBody('token: "Synthetic credential value"').blocked, true);
  assert.equal(scanRequestBody('notes: "Synthetic credential value"').blocked, false);

  for (const normal of [
    "Explain why passwords should never be pasted into prompts.",
    "Use process.env.API_KEY instead of a literal value.",
    "password = <redacted>",
    { tools: [{ parameters: { properties: { password: { type: "string" } } } }] },
    { token: "placeholder" },
  ]) {
    assert.equal(scanRequestBody(normal).blocked, false);
  }
});

test("strict mode rejects unauthorized upstreams on Chat, Responses, and Anthropic", async () => {
  const provider = await createMockProvider();
  const model = testModel("strict-origin", "zen");
  const daemon = await createTestDaemon(strictSecurity([]), [testUpstream("zen", provider.url)], [model]);
  try {
    for (const wire of wireRequests(model.id, "ordinary prompt")) {
      const response = await postJson(daemon.baseUrl, wire.path, wire.body);
      assert.equal(response.status, 403, wire.name);
    }
    assert.equal(provider.hits, 0);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("strict DLP blocks OpenAI, GitHub, and SSH secrets on all wire protocols without logging values", async () => {
  const provider = await createMockProvider();
  // Classification is based on the configured destination. The invalid host must
  // never be resolved because DLP blocks before fetch; the local server counts leaks.
  const externalUrl = "https://provider.invalid/v1/chat/completions";
  const model = testModel("strict-origin", "zen");
  const entries: Array<Record<string, unknown>> = [];
  const daemon = await createTestDaemon(
    strictSecurity(["zen"]),
    [testUpstream("zen", externalUrl)],
    [model],
    recordingLogger(entries),
  );
  const secrets = [
    ["sk", "proj", "E".repeat(24)].join("-"),
    `github_pat_${"F".repeat(24)}`,
    "-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic\n-----END OPENSSH PRIVATE KEY-----",
  ];
  try {
    const requests = wireRequests(model.id, "unused");
    for (let i = 0; i < requests.length; i++) {
      const wire = requests[i]!;
      const secret = secrets[i]!;
      const response = await postJson(
        daemon.baseUrl,
        wire.path,
        wireRequests(model.id, secret)[i]!.body,
      );
      assert.equal(response.status, 422, wire.name);
      const responseText = await response.text();
      assert.equal(responseText.includes(secret), false);
    }
    assert.equal(provider.hits, 0);
    const logText = JSON.stringify(entries);
    for (const secret of secrets) assert.equal(logText.includes(secret), false);
    assert.equal(logText.includes("dlpBlocked"), true);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("strict mode blocks cross-provider failover consistently on all wire protocols", async () => {
  const originProvider = await createMockProvider(429, JSON.stringify({ error: { message: "rate limited" } }));
  const fallbackProvider = await createMockProvider();
  const origin = testModel("strict-origin", "zen");
  const fallback = testModel("strict-fallback", "kilo");
  const entries: Array<Record<string, unknown>> = [];
  const daemon = await createTestDaemon(
    strictSecurity(["zen", "kilo"]),
    [testUpstream("zen", originProvider.url), testUpstream("kilo", fallbackProvider.url)],
    [origin, fallback],
    recordingLogger(entries),
  );
  try {
    for (const wire of wireRequests(origin.id, "ordinary prompt")) {
      const response = await postJson(daemon.baseUrl, wire.path, wire.body);
      assert.equal(response.status, 429, wire.name);
    }
    assert.equal(originProvider.hits, 3);
    assert.equal(fallbackProvider.hits, 0);
    assert.equal(JSON.stringify(entries).includes("failoverBlocked"), true);
  } finally {
    await daemon.close();
    await originProvider.close();
    await fallbackProvider.close();
  }
});

test("strict relay policy rejects CLI, API mutation, and API probe", async () => {
  const strict = strictSecurity(["zen"]);
  assert.equal(await runRelay(["on"], strict), 1);

  const daemon = await createTestDaemon(strict, [], []);
  try {
    const state = await fetch(`${daemon.baseUrl}/bansos/relay`);
    const body = await state.json() as { enabled: boolean; locked: boolean; securityMode: string };
    assert.equal(body.enabled, false);
    assert.equal(body.locked, true);
    assert.equal(body.securityMode, "strict");

    const mutation = await postJson(daemon.baseUrl, "/bansos/relay", {
      enabled: true,
      url: "https://relay.invalid",
    });
    assert.equal(mutation.status, 403);

    const probe = await postJson(daemon.baseUrl, "/bansos/relay/probe", {
      url: "http://127.0.0.1:1",
    });
    assert.equal(probe.status, 403);
  } finally {
    await daemon.close();
  }
});

test("normal prompts pass strict policy on Chat, Responses, and Anthropic", async () => {
  const provider = await createMockProvider();
  const model = testModel("strict-origin", "zen");
  const daemon = await createTestDaemon(strictSecurity(["zen"]), [testUpstream("zen", provider.url)], [model]);
  try {
    for (const wire of wireRequests(model.id, "Summarize this harmless local test input.")) {
      const response = await postJson(daemon.baseUrl, wire.path, wire.body);
      assert.equal(response.status, 200, wire.name);
    }
    assert.equal(provider.hits, 3);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("logger drops sensitive fields and strict upstream raw errors", async () => {
  const syntheticSecret = ["sk", "proj", "G".repeat(24)].join("-");
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    createLogger({ json: true }).info("safe event", {
      Authorization: syntheticSecret,
      cookie: syntheticSecret,
      toolOutput: syntheticSecret,
      model: syntheticSecret,
      secretType: "openai_api_key",
    });
    createLogger({ json: true }).warn(syntheticSecret);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(output.includes(syntheticSecret), false);
  assert.equal(output.includes("openai_api_key"), true);
  assert.equal(output.includes("sensitive log message suppressed"), true);

  const provider = await createMockProvider(
    400,
    JSON.stringify({ error: { message: syntheticSecret } }),
  );
  const model = testModel("strict-origin", "zen");
  const entries: Array<Record<string, unknown>> = [];
  const daemon = await createTestDaemon(
    strictSecurity(["zen"]),
    [testUpstream("zen", provider.url)],
    [model],
    recordingLogger(entries),
  );
  try {
    const response = await postJson(
      daemon.baseUrl,
      "/v1/chat/completions",
      wireRequests(model.id, "ordinary prompt")[0]!.body,
    );
    assert.equal(response.status, 400);
    assert.equal((await response.text()).includes(syntheticSecret), false);
    assert.equal(JSON.stringify(entries).includes(syntheticSecret), false);
  } finally {
    await daemon.close();
    await provider.close();
  }
});
