import { test } from "node:test";
import assert from "node:assert/strict";
import { diffEvents, routePath, sCurvePath, buildTripRoute, verticalBusPath, buildVerticalTripRoute, MAX_TRIPS_PER_POLL } from "../src/ui/utils/routing";
import type { ActivityEvent } from "../src/ui/types";

function event(id: number, timestamp: number, upstream = "zen"): ActivityEvent {
  return {
    id,
    timestamp,
    kind: "chat",
    model: "deepseek-v4.1-flash-free",
    requestedModel: "deepseek-v4.1-flash-free",
    upstream,
    inputTokens: 10,
    outputTokens: 5,
    durationMs: 900,
    status: "ok",
    statusCode: 200,
  };
}

test("diffEvents keeps events sharing the last seen timestamp", () => {
  const seen = new Set([1]);
  const events = [event(1, 2000), event(2, 2000), event(3, 2000)];
  const { fresh, seed } = diffEvents(events, seen, 2000);
  assert.equal(seed, false);
  assert.deepEqual(fresh.map((e) => e.id), [2, 3]);
});

test("diffEvents returns only events newer than the last seen timestamp", () => {
  const seen = new Set([1]);
  const events = [event(1, 1000), event(2, 2000), event(3, 3000)];
  const { fresh, seed } = diffEvents(events, seen, 2000);
  assert.equal(seed, false);
  assert.deepEqual(fresh.map((e) => e.id), [2, 3]);
});

test("diffEvents ignores older rows from a window switch", () => {
  const seen = new Set<number>();
  const events = [event(1, 500), event(2, 900)];
  const { fresh, seed } = diffEvents(events, seen, 2000);
  assert.equal(seed, false);
  assert.deepEqual(fresh, []);
});

test("diffEvents caps a burst at MAX_TRIPS_PER_POLL, keeping the newest", () => {
  const events = [event(1, 1000), event(2, 2000), event(3, 3000), event(4, 4000)];
  const { fresh, seed } = diffEvents(events, new Set(), 500);
  assert.equal(seed, false);
  assert.equal(fresh.length, MAX_TRIPS_PER_POLL);
  assert.deepEqual(fresh.map((e) => e.id), [2, 3, 4]);
});

test("diffEvents asks for a reseed on a bulk change", () => {
  const events = Array.from({ length: 5 }, (_, i) => event(i + 1, 1000 + i));
  const { fresh, seed } = diffEvents(events, new Set(), 500);
  assert.equal(seed, true);
  assert.deepEqual(fresh, []);
});

test("routePath draws a straight line for two points", () => {
  assert.equal(routePath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), "M 0 0 L 10 0");
});

test("routePath rounds corners with a quadratic segment", () => {
  const d = routePath([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);
  assert.match(d, /Q 100 0/);
  assert.ok(d.endsWith("L 100 100"));
});

test("routePath keeps a reversal finite instead of emitting NaN", () => {
  const d = routePath([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.ok(!d.includes("NaN"));
  assert.equal(d, "M 0 0 L 100 0 L 0 0");
});

test("sCurvePath generates smooth cubic bezier with midpoints", () => {
  const d = sCurvePath({ x: 0, y: 10 }, { x: 100, y: 50 });
  assert.equal(d, "M 0 10 C 50 10, 50 50, 100 50");
});

test("buildTripRoute contains outbound and return S-curves", () => {
  const d = buildTripRoute({ x: 10, y: 50 }, { x: 100, y: 50 }, { x: 150, y: 50 }, { x: 250, y: 10 });
  assert.ok(d.startsWith("M 10 50 L 100 50 L 150 50 C 200 50, 200 10, 250 10"));
  assert.ok(d.endsWith("L 100 50 L 10 50"));
});

test("verticalBusPath generates curve into bus and horizontal branch", () => {
  const d = verticalBusPath({ x: 100, y: 120 }, 20, { x: 80, y: 200 });
  assert.ok(d.startsWith("M 100 120 C 100 134, 20 130, 20 144"));
  assert.ok(d.endsWith("L 20 200 L 80 200"));
});

test("buildVerticalTripRoute contains round-trip vertical transit", () => {
  const d = buildVerticalTripRoute(
    { x: 100, y: 20 },
    { x: 100, y: 60 },
    { x: 100, y: 80 },
    { x: 100, y: 100 },
    { x: 100, y: 120 },
    20,
    { x: 80, y: 200 },
  );
  assert.ok(d.startsWith("M 100 20 L 100 60 L 100 80 L 100 100 L 100 120 C 100 134, 20 130, 20 144"));
  assert.ok(d.includes("L 80 200"));
  assert.ok(d.endsWith("L 100 60 L 100 20"));
});
