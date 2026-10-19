import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_TARGETS } from "../src/relay/egress";
import { DEFAULT_UPSTREAMS } from "../src/upstreams";

// The relay forwards to `x-relay-target` only when that origin is allowlisted,
// and relayFetch derives the target from each upstream's chatUrl origin. If the
// two drift apart the upstream silently goes direct — no error, no log, just an
// unused relay. Caught in production: ALLOWED_TARGETS held "https://llm7.io"
// while LLM7_BASE_URL is "https://api.llm7.io/v1", so llm7 bypassed the relay
// entirely while zen and kilo went through it.
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
