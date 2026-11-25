import test from "node:test";
import assert from "node:assert/strict";
import { retryBootRefresh } from "../src/daemon/index";
import type { RefreshReport } from "../src/daemon/catalog";

function report(unreachable: string[] = []): RefreshReport {
  return { checked: 0, alive: 0, dead: 0, degraded: [], unreachable };
}

test("boot retry keeps polling while an upstream is unreachable", async () => {
  const reports = [report(["zen"]), report(["zen", "kilo"]), report()];
  let calls = 0;
  const delays: number[] = [];
  await retryBootRefresh(
    { refresh: async () => reports[calls++]! },
    { baseMs: 1_000, maxMs: 4_000, sleep: async (ms) => void delays.push(ms) },
  );
  assert.equal(calls, 3, "stops as soon as a pass is fully reachable");
  assert.deepEqual(delays, [1_000, 2_000, 4_000], "backs off, capped at maxMs");
});

test("boot retry stops backing off at the cap", async () => {
  const delays: number[] = [];
  let calls = 0;
  await retryBootRefresh(
    {
      refresh: async () => {
        calls++;
        return report(calls < 5 ? ["zen"] : []);
      },
    },
    { baseMs: 1_000, maxMs: 3_000, sleep: async (ms) => void delays.push(ms) },
  );
  assert.deepEqual(delays, [1_000, 2_000, 3_000, 3_000, 3_000], "capped, not unbounded");
});

test("boot retry gives up when a pass throws, leaving the interval in charge", async () => {
  let calls = 0;
  await retryBootRefresh(
    {
      refresh: async () => {
        calls++;
        throw new Error("boom");
      },
    },
    { baseMs: 1_000, maxMs: 2_000, sleep: async () => {} },
  );
  assert.equal(calls, 1);
});
