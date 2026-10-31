import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, parseRateLimit } from "../src/daemon/rate-limit";
import { countsTowardRateLimit } from "../src/daemon/server";

test("parseRateLimit: unset or invalid gives the default, 0 disables", () => {
  for (const raw of [undefined, "", "  ", "abc", "-5"]) assert.equal(parseRateLimit(raw), 300);
  assert.equal(parseRateLimit("0"), 0);
  assert.equal(parseRateLimit("50"), 50);
  assert.equal(parseRateLimit("12.7"), 12);
});

test("countsTowardRateLimit skips dashboard reads and counts API and mutations", () => {
  for (const [method, url] of [
    ["GET", "/bansos/status"],
    ["GET", "/bansos/events?limit=5"],
    ["GET", "/bansos/logs"],
    ["GET", "/healthz/"],
    ["GET", "/"],
    ["GET", "/assets/index-abc.js"],
    ["OPTIONS", "/v1/chat/completions"],
  ]) assert.equal(countsTowardRateLimit(method!, url!), false, `${method} ${url}`);
  for (const [method, url] of [
    ["POST", "/v1/chat/completions"],
    ["GET", "/v1/models"],
    ["GET", "/models"],
    ["POST", "/bansos/config"],
    ["GET", "/bansos/doctor"],
    ["GET", "/bansos/config"],
    ["GET", "/bansos/adapters"],
    ["GET", "/bansos/autostart"],
    ["GET", "/bansos/relay"],
    ["GET", "/nope"],
  ]) assert.equal(countsTowardRateLimit(method!, url!), true, `${method} ${url}`);
});

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
