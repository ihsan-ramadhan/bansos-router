import test from "node:test";
import assert from "node:assert/strict";
import { isFreeLlm7Model } from "../src/upstreams/llm7";

test("isFreeLlm7Model excludes pro tier even when usage_based_only is false", () => {
  // the real regression: kimi-k2.6 is pro + usage_based_only false, and 402s
  assert.equal(isFreeLlm7Model({ tier: "pro", usage_based_only: false }), false);
  assert.equal(isFreeLlm7Model({ tier: "pro", usage_based_only: true }), false);
});

test("isFreeLlm7Model keeps anonymous and turbo models", () => {
  assert.equal(isFreeLlm7Model({ usage_based_only: false }), true);
  assert.equal(isFreeLlm7Model({ tier: "free", usage_based_only: false }), true);
  assert.equal(isFreeLlm7Model({ tier: "turbo" }), true);
  assert.equal(isFreeLlm7Model({ tier: "turbo", usage_based_only: false }), true);
});

test("isFreeLlm7Model drops usage-based and underspecified models", () => {
  assert.equal(isFreeLlm7Model({ tier: "turbo", usage_based_only: true }), false);
  assert.equal(isFreeLlm7Model({}), false, "no signal at all is not provably free");
});
