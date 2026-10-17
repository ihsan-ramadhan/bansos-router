import test from "node:test";
import assert from "node:assert/strict";
import { displayName } from "../extensions/pi/src/models";

test("pi model names carry their upstream so /model shows where each one runs", () => {
  assert.equal(displayName({ id: "big-pickle", name: "Big Pickle", source: "zen" }), "Big Pickle (Zen)");
  assert.equal(displayName({ id: "ovh/gpt-oss-120b", name: "gpt-oss-120b", source: "ovh" }), "gpt-oss-120b (OVH)");
  assert.equal(displayName({ id: "fast", name: "LLM7 Fast", source: "llm7" }), "LLM7 Fast", "no doubled label");
  assert.equal(displayName({ id: "x", source: "local" }), "x (Local)");
  assert.equal(displayName({ id: "y" }), "y");
});

test("pi model list prefers live, then the last cached catalog, then the bundled snapshot", async () => {
  const { chooseModels, readCachedModels, writeCachedModels, toProviderModel } = await import("../extensions/pi/src/models");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-cache-")), "pi-models.json");

  assert.deepEqual(readCachedModels(file), [], "missing cache reads as empty");
  writeCachedModels([{ id: "live-a", source: "zen" }], file);
  const cached = readCachedModels(file);
  assert.deepEqual(cached.map((m) => m.id), ["live-a"]);

  assert.deepEqual(chooseModels([{ id: "now" }], cached).map((m) => m.id), ["now"]);
  assert.deepEqual(chooseModels([], cached).map((m) => m.id), ["live-a"]);
  const snapshot = chooseModels([], []);
  assert.ok(snapshot.length > 0 && !snapshot.some((m) => m.id === "muse-spark-1.3-contributor-free" || m.id === "mimo-v2.5-free"), "no retired ids");

  const vision = toProviderModel({ id: "v", input: ["text", "image"], reasoning: false });
  assert.deepEqual(vision.input, ["text", "image"]);
  assert.equal(toProviderModel({ id: "deepseek-x" }).reasoning, false, "reasoning comes from the daemon, not the id");
});
