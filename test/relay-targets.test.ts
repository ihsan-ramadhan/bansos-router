import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_TARGETS, relayFetch } from "../src/relay/egress";
import { DEFAULT_UPSTREAMS } from "../src/upstreams";

// an upstream whose chatUrl origin is missing here silently skips the relay instead of failing
test("every relayAllowed upstream origin is in ALLOWED_TARGETS", () => {
  const allowed = new Set(ALLOWED_TARGETS);
  const checked: string[] = [];
  for (const up of DEFAULT_UPSTREAMS) {
    if (!up.relayAllowed) continue;
    const origin = new URL(up.chatUrl).origin;
    checked.push(`${up.id}=${origin}`);
    assert.ok(
      allowed.has(origin),
      `upstream "${up.id}" is relayAllowed but its origin ${origin} is missing from ALLOWED_TARGETS (${[...allowed].join(", ")})`,
    );
  }
  assert.ok(checked.length > 0, "expected at least one relayAllowed upstream");
});

test("ALLOWED_TARGETS entries are bare origins", () => {
  for (const t of ALLOWED_TARGETS) {
    assert.equal(new URL(t).origin, t, `${t} must be an origin (no path/trailing slash)`);
  }
});

test("relayFetch tries the relay, then falls back to the direct target", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("http://127.0.0.1:1")) throw new TypeError("fetch failed");
    return new Response("direct", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await relayFetch(
      { enabled: true, url: "http://127.0.0.1:1/relay", relays: [] },
      "https://api.llm7.io/v1/chat/completions",
      { method: "POST", body: "{}" },
    );
    assert.equal(await res.text(), "direct");
    assert.deepEqual(calls, ["http://127.0.0.1:1/relay", "https://api.llm7.io/v1/chat/completions"]);
  } finally {
    globalThis.fetch = original;
  }
});
