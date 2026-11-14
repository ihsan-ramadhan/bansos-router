import test from "node:test";
import assert from "node:assert/strict";
import { exactTitle, formatCount, formatExact } from "../src/ui/utils/format";

test("counts stay exact below a thousand and compact above it", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(121), "121");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1_000), "1k");
  assert.equal(formatCount(3_472), "3.5k");
  assert.equal(formatCount(62_255), "62.3k");
  assert.equal(formatCount(1_000_000), "1M");
  assert.equal(formatCount(7_250_893), "7.3M");
});

test("rounding never leaks a four-digit value into the smaller unit", () => {
  assert.equal(formatCount(999_949), "999.9k");
  assert.equal(formatCount(999_950), "1M");
  assert.equal(formatCount(999_949_999), "999.9M");
  assert.equal(formatCount(999_950_000), "1B");
});

test("non-finite values render a dash", () => {
  assert.equal(formatCount(Number.NaN), "-");
  assert.equal(formatCount(Number.POSITIVE_INFINITY), "-");
  assert.equal(formatExact(Number.NaN), "-");
});

test("exact title only appears when the shown value is abbreviated", () => {
  assert.equal(exactTitle(121), undefined);
  assert.equal(exactTitle(999), undefined);
  assert.equal(exactTitle(1_000), "1,000");
  assert.equal(exactTitle(7_250_893), "7,250,893");
});
