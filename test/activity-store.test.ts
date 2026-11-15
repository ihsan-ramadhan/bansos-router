import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ActivityStore, ACTIVITY_DIR, type ActivityEvent } from "../src/daemon/activity";
import { BANSOS_DIR } from "../src/daemon/state";
import { clampMaxTokens } from "../src/daemon/server";

const sample = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: 0,
  timestamp: Date.now(),
  kind: "chat",
  model: "deepseek-v4.1-flash-free",
  requestedModel: "deepseek-v4.1-flash-free",
  upstream: "zen",
  inputTokens: 100,
  outputTokens: 10,
  cachedTokens: 40,
  durationMs: 1200,
  status: "ok",
  ...over,
});

test("events are appended to month files and survive a restart without pruning", async () => {
  const store = new ActivityStore();
  store.clear();

  store.record({ ...sample(), kind: "chat" });
  store.record({ ...sample({ status: "error", statusCode: 429, model: "big-pickle" }), kind: "chat" });
  // an event far outside the old 60-day window: keeping everything is the point
  store.importEvents([sample({ id: 9001, timestamp: Date.parse("2024-01-05T10:00:00Z"), model: "glm-5.3-flash-free" })]);
  await store.whenIdle();
  store.flush();

  assert.equal(store.getAllEvents().length, 3, "all three events are on disk");

  const reopened = new ActivityStore();
  const all = reopened.getUsage("all");
  assert.equal(all.totalRequests, 3, "an event from 2024 still counts in the all-time window");
  assert.equal(all.okRequests, 2);
  assert.equal(all.errorRequests, 1);
  assert.equal(all.totalInputTokens, 300);
  assert.equal(all.totalCachedTokens, 120);
  assert.ok(all.perModel["glm-5.3-flash-free"], "old models stay in the per-model rollup");

  const today = reopened.getUsage("today");
  assert.equal(today.totalRequests, 2, "the 2024 event is outside the today window");

  const events = reopened.getEvents(10, "all");
  assert.equal(events.length, 3);
  assert.equal(events[0]!.id > events[1]!.id, true, "newest first");
});

test("the recent ring is refilled from disk and ids continue after a restart", async () => {
  const store = new ActivityStore();
  store.clear();
  store.record({ ...sample() });
  await store.whenIdle();
  const firstId = store.getEvents(1, "all")[0]!.id;

  const reopened = new ActivityStore();
  assert.equal(reopened.getEvents(1, "all").length, 1, "the tail read restored the recent feed");
  reopened.record({ ...sample() });
  await reopened.whenIdle();
  const ids = reopened.getEvents(5, "all").map((e) => e.id);
  assert.ok(Math.max(...ids) > firstId, "ids keep climbing, no reuse");
  assert.equal(new Set(ids).size, ids.length, "ids stay unique");
});

test("a merge import never duplicates and a replace import swaps the whole history", async () => {
  const store = new ActivityStore();
  store.clear();
  const incoming = [sample({ id: 11 }), sample({ id: 12 })];
  assert.equal(store.importEvents(incoming), 2);
  assert.equal(store.importEvents(incoming), 0, "the same backup twice adds nothing");
  assert.equal(store.getUsage("all").totalRequests, 2);

  assert.equal(store.importEvents([sample({ id: 21 })], true), 1);
  assert.equal(store.getUsage("all").totalRequests, 1);
  assert.equal(store.getAllEvents().map((e) => e.id).join(","), "21");
});

test("the old single-file store is migrated once and then left alone", async () => {
  const store = new ActivityStore();
  store.clear();
  const legacy = path.join(BANSOS_DIR, "activity.json");
  fs.writeFileSync(legacy, JSON.stringify({ updatedAt: Date.now(), events: [sample({ id: 7 })] }));

  const migrated = new ActivityStore();
  assert.equal(migrated.getUsage("all").totalRequests, 1, "legacy events are carried over");
  assert.equal(fs.existsSync(legacy), false, "the old file is moved aside");
  assert.equal(fs.existsSync(`${legacy}.migrated`), true);
  assert.equal(fs.existsSync(ACTIVITY_DIR), true);

  const again = new ActivityStore();
  assert.equal(again.getUsage("all").totalRequests, 1, "migration does not run twice");
});

test("clampMaxTokens caps both chat and responses token fields to the target model", () => {
  const capped = clampMaxTokens({ max_tokens: 32000, max_completion_tokens: 32000 }, { maxTokens: 8192 });
  assert.equal(capped.max_tokens, 8192);
  assert.equal(capped.max_completion_tokens, 8192);
  const kept = clampMaxTokens({ max_tokens: 1000 }, { maxTokens: 8192 });
  assert.equal(kept.max_tokens, 1000);
  const untouched = clampMaxTokens({ temperature: 0.2 }, { maxTokens: 8192 });
  assert.deepEqual(untouched, { temperature: 0.2 });
});
