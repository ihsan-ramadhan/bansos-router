import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MIN_BUN_VERSION, runtimeError } from "../src/cli/runtime";

test("the runtime guard minimum matches engines.bun in package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.engines.bun, `>=${MIN_BUN_VERSION}`);
});

test("node is refused with install and autostart hints", () => {
  const msg = runtimeError({}, { node: "22.19.0" });
  assert.ok(msg);
  assert.match(msg, /Bun >= 1\.3\.0/);
  assert.match(msg, /found Node 22\.19\.0/);
  assert.match(msg, /https:\/\/bun\.sh/);
  assert.match(msg, /autostart on/);
});

test("a bun older than the minimum is refused", () => {
  const msg = runtimeError({ Bun: { version: "1.2.9", semver: Bun.semver } }, {});
  assert.ok(msg);
  assert.match(msg, /found Bun 1\.2\.9/);
});

test("the current bun runtime passes the guard", () => {
  assert.equal(runtimeError(), null);
});
