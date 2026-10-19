import test from "node:test";
import assert from "node:assert/strict";
import { pickFromChecked, pickedModels, setupCommand } from "../src/ui/utils/agent";
import type { ModelItem } from "../src/ui/types";

const model = (id: string, source: string) => ({ id, source, owned_by: source }) as ModelItem;
const MODELS = [model("big-pickle", "zen"), model("cat-jam-free", "zen"), model("kilo-auto/free", "kilo"), model("fast", "llm7")];

test("a fully checked provider becomes an upstream pick and partial ones stay ids", () => {
  assert.deepEqual(pickFromChecked(MODELS, ["big-pickle", "cat-jam-free", "fast"]), { upstreams: ["zen", "llm7"] });
  assert.deepEqual(pickFromChecked(MODELS, ["big-pickle", "kilo-auto/free"]), { upstreams: ["kilo"], models: ["big-pickle"] });
  assert.deepEqual(pickFromChecked(MODELS, ["gone-model"]), {}, "ids no longer in the catalog are dropped");
});

test("the CLI command mirrors the pick", () => {
  assert.equal(setupCommand("opencode", {}), "bansos setup opencode");
  assert.equal(setupCommand("aider", { model: "big-pickle" }), "bansos setup aider --model big-pickle");
  assert.equal(
    setupCommand("opencode", { upstreams: ["zen", "kilo"], models: ["fast"] }),
    "bansos setup opencode --upstream zen,kilo --models fast",
  );
});

test("a checked upstream keeps covering models a catalog refresh adds, while vanished ids drop out", () => {
  const pick = pickFromChecked(MODELS, ["kilo-auto/free", "big-pickle"]);
  const refreshed = [...MODELS.filter((m) => m.id !== "big-pickle"), model("kilo-new:free", "kilo")];
  assert.deepEqual(pickedModels(refreshed, pick).map((m) => m.id), ["kilo-auto/free", "kilo-new:free"]);
});
