import test from "node:test";
import assert from "node:assert/strict";
import {
  auditGateShape,
  classifyGateError,
  ensureFullGateTools,
  FULL_GATE_TOOL_NAMES,
  GateCooldown,
  GATE_RETRY_COOLDOWN_MS,
  parseVersionFloor,
  refreshGateRecipe,
  resetGateRecipeForTests,
  toolNamesOf,
} from "../src/upstreams/zen-gate";

test("classifyGateError separates ip-abuse from ambiguous free-tier", () => {
  assert.equal(classifyGateError(403, "detected abusive traffic from this IP address"), "ip-abuse");
  assert.equal(classifyGateError(403, "Detect Abuse Traffic"), "ip-abuse");
  assert.equal(
    classifyGateError(403, "FreeTierError: OpenCode's free tier can only be used from within OpenCode"),
    "free-tier",
  );
  assert.equal(classifyGateError(426, "UpgradeRequired: minimum 2.1.0"), "upgrade-required");
  assert.equal(classifyGateError(404, "not found"), "endpoint-moved");
  assert.equal(classifyGateError(500, "boom"), "other");
});

test("parseVersionFloor extracts the minimum version from a 426 message", () => {
  assert.equal(parseVersionFloor("UpgradeRequired: minimum 2.1.0 required"), "2.1.0");
  assert.equal(parseVersionFloor("no version here"), null);
});

test("auditGateShape pins the read tool and session headers", () => {
  const bad = auditGateShape({ "User-Agent": "node-fetch" }, []);
  assert.equal(bad.shapeOk, false);
  assert.deepEqual(bad.missingTools, ["read"]);
  assert.ok(bad.missingHeaders.includes("x-opencode-session"));
  assert.ok(bad.missingHeaders.includes("x-session-affinity"));

  const good = auditGateShape(
    {
      "User-Agent": "opencode/latest/2.1.3/cli",
      "x-opencode-session": "ses_0123456789ababcdefghijklmn",
      "x-session-affinity": "ses_0123456789ababcdefghijklmn",
    },
    ["read", "shell"],
  );
  assert.equal(good.shapeOk, true);
});

test("toolNamesOf reads chat-nested and responses-flat tools", () => {
  assert.deepEqual(
    toolNamesOf({ tools: [{ type: "function", function: { name: "read" } }] }),
    ["read"],
  );
  assert.deepEqual(
    toolNamesOf({ tools: [{ type: "function", name: "shell" }] }),
    ["shell"],
  );
});

test("ensureFullGateTools adds the full profile without duplicating declared tools", () => {
  const chat: Record<string, unknown> = {
    tools: [{ type: "function", function: { name: "read" } }],
  };
  assert.equal(ensureFullGateTools(chat, "chat"), true);
  const names = toolNamesOf(chat);
  assert.equal(names.length, FULL_GATE_TOOL_NAMES.length);
  assert.equal(names.filter((n) => n === "read").length, 1);
  assert.equal(ensureFullGateTools(chat, "chat"), false);

  const responses: Record<string, unknown> = { tools: [] };
  ensureFullGateTools(responses, "responses");
  const first = (responses.tools as Record<string, unknown>[])[0]!;
  assert.equal(first.type, "function");
  assert.equal(typeof first.name, "string");
});

test("GateCooldown suppresses retries only for the same identity inside the window", () => {
  const cooldown = new GateCooldown();
  cooldown.recordFailedFullShape("ses_abc");
  assert.equal(cooldown.isCoolingDown("ses_abc"), true);
  assert.equal(cooldown.isCoolingDown("ses_other"), false);
  assert.equal(cooldown.isCoolingDown("ses_abc", Date.now() + GATE_RETRY_COOLDOWN_MS + 1), false);
});

test("refreshGateRecipe derives version and tool names live, and falls back on failure", async () => {
  resetGateRecipeForTests();
  let calls = 0;
  const stubFetch = (async (url: string) => {
    calls++;
    if (String(url).includes("update/api")) {
      return {
        ok: true,
        json: async () => ({
          version: "2.9.9",
          metadata: { github: { sha: "abcdef1234567890abcdef1234567890abcdef12" } },
        }),
      } as unknown as Response;
    }
    if (String(url).includes("api.github.com")) {
      return {
        ok: true,
        json: async () => [
          { name: "read.ts", type: "file" },
          { name: "shell.ts", type: "file" },
          { name: "glob.ts", type: "file" },
          { name: "index.ts", type: "file" },
        ],
      } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;

  const live = await refreshGateRecipe(stubFetch);
  assert.equal(live.source, "live");
  assert.equal(live.userAgent, "opencode/latest/2.9.9/cli");
  assert.equal(live.sourceRef, "abcdef1234567890abcdef1234567890abcdef12");
  assert.ok(live.toolNames.includes("read"));
  assert.ok(live.toolNames.includes("glob"));
  assert.ok(!live.toolNames.includes("index"));

  // Second call inside the TTL reuses the cache instead of fetching again.
  const cachedCalls = calls;
  await refreshGateRecipe(stubFetch);
  assert.equal(calls, cachedCalls);

  resetGateRecipeForTests();
  const failingFetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const fallback = await refreshGateRecipe(failingFetch);
  assert.equal(fallback.source, "fallback");
  assert.equal(fallback.userAgent, "opencode/latest/2.1.3/cli");
  assert.ok(fallback.toolNames.includes("read"));
  resetGateRecipeForTests();
});
