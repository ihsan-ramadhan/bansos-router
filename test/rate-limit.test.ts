import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/daemon/rate-limit";

test("RateLimiter allows up to the limit within a window", () => {
  const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
  const now = 1_000_000;
  assert.equal(rl.check("1.2.3.4", now), true);
  assert.equal(rl.check("1.2.3.4", now + 1), true);
  assert.equal(rl.check("1.2.3.4", now + 2), true);
  assert.equal(rl.check("1.2.3.4", now + 3), false);
});

test("RateLimiter tracks IPs independently", () => {
  const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(rl.check("a", 1_000), true);
  assert.equal(rl.check("a", 1_001), false);
  assert.equal(rl.check("b", 1_002), true);
});

test("RateLimiter expires hits outside the window", () => {
  const rl = new RateLimiter({ limit: 1, windowMs: 1_000 });
  assert.equal(rl.check("ip", 1_000), true);
  assert.equal(rl.check("ip", 1_500), false); // still in window
  assert.equal(rl.check("ip", 2_001), true); // window slid past
});

test("RateLimiter limit=0 disables enforcement", () => {
  const rl = new RateLimiter({ limit: 0, windowMs: 1_000 });
  assert.equal(rl.check("any", 1_000), true);
  assert.equal(rl.check("any", 1_001), true);
});

test("RateLimiter retryAfterMs reports when the window frees up", () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 1_000 });
  const now = 10_000;
  assert.equal(rl.retryAfterMs("ip", now), 0);
  rl.check("ip", now);
  assert.equal(rl.retryAfterMs("ip", now), 0);
  rl.check("ip", now + 100);
  assert.equal(rl.retryAfterMs("ip", now + 100), 900);
  assert.equal(rl.retryAfterMs("ip", now + 1_000), 0);
});
