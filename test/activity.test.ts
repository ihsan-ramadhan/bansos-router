import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ACTIVITY_FILE, ActivityStore, type ActivityInput } from "../src/daemon/activity";
import { BANSOS_DIR } from "../src/daemon/state";

const input: ActivityInput = {
  kind: "chat",
  model: "m",
  requestedModel: "m",
  upstream: "zen",
  inputTokens: 1,
  outputTokens: 2,
  durationMs: 3,
  status: "ok",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  fs.rmSync(ACTIVITY_FILE, { force: true });
});

test("flushToDisk writes compact JSON the loader reads back", async () => {
  const store = new ActivityStore();
  for (let i = 0; i < 3; i++) store.record(input);
  await store.flushToDisk();
  const text = fs.readFileSync(ACTIVITY_FILE, "utf8");
  assert.ok(!text.includes("\n  "), "expected compact JSON");
  const data = JSON.parse(text) as { updatedAt: number; events: { id: number }[] };
  assert.equal(typeof data.updatedAt, "number");
  assert.deepEqual(data.events.map((e) => e.id), [1, 2, 3]);

  const reloaded = new ActivityStore();
  assert.deepEqual(reloaded.getEvents(10).map((e) => e.id), [3, 2, 1]);
  reloaded.record(input);
  assert.equal(reloaded.getEvents(1)[0]!.id, 4);
  reloaded.flushToDiskSync();
  store.flushToDiskSync();
});

test("record keeps only the newest events past the cap, in order", () => {
  const store = new ActivityStore(3);
  for (let i = 0; i < 5; i++) store.record(input);
  assert.deepEqual(store.getEvents(10).map((e) => e.id).reverse(), [3, 4, 5]);
  store.flushToDiskSync();
});

test("overlapping flushes coalesce, end with the latest events and leave no temp files", async () => {
  const store = new ActivityStore();
  store.record(input);
  const first = store.flushToDisk();
  store.record(input);
  const second = store.flushToDisk();
  await Promise.all([first, second]);
  await sleep(100);
  const data = JSON.parse(fs.readFileSync(ACTIVITY_FILE, "utf8")) as { events: { id: number }[] };
  assert.deepEqual(data.events.map((e) => e.id), [1, 2]);
  assert.deepEqual(fs.readdirSync(BANSOS_DIR).filter((f) => f.endsWith(".tmp")), []);
  store.flushToDiskSync();
});

test("flushToDiskSync writes immediately and wins over an in-flight async write", () => {
  const store = new ActivityStore();
  store.record(input);
  void store.flushToDisk();
  store.record(input);
  store.flushToDiskSync();
  const data = JSON.parse(fs.readFileSync(ACTIVITY_FILE, "utf8")) as { events: { id: number }[] };
  assert.deepEqual(data.events.map((e) => e.id), [1, 2]);
});

test("the dropped async write never overwrites the shutdown flush", async () => {
  const store = new ActivityStore();
  store.record(input);
  const pending = store.flushToDisk();
  store.record(input);
  store.flushToDiskSync();
  await pending;
  await sleep(50);
  const data = JSON.parse(fs.readFileSync(ACTIVITY_FILE, "utf8")) as { events: { id: number }[] };
  assert.deepEqual(data.events.map((e) => e.id), [1, 2]);
  assert.deepEqual(fs.readdirSync(BANSOS_DIR).filter((f) => f.endsWith(".tmp")), []);
});
