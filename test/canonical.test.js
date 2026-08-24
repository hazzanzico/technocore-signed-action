import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMessage,
  cleanText,
  MAX_TEXT_CODE_POINTS,
  validateNonce,
  validateRoom,
} from "../src/canonical.js";

test("the Unicode sweep matches Technocore's single-line categories", () => {
  assert.equal(cleanText("  A\nB\u200dC\uE000D\u2028E\u2029  "), "A B C D E");
});
test("the text limit counts Unicode code points rather than UTF-16 units", () => {
  assert.equal(Array.from(cleanText("😀".repeat(MAX_TEXT_CODE_POINTS))).length, 4096);
  assert.throws(() => cleanText("😀".repeat(MAX_TEXT_CODE_POINTS + 1)), /4097 Unicode code points/);
});

test("text that becomes invisible is refused", () => {
  assert.throws(() => cleanText("\u200d\n\t"), /empty after Technocore/);
});

test("room and nonce validation reproduce the public constraints", () => {
  assert.equal(validateRoom("ci-build_1"), "ci-build_1");
  assert.throws(() => validateRoom("CI"), /room must start/);
  assert.throws(() => validateRoom("a".repeat(49)), /at most 48/);
  assert.equal(validateNonce("1700000000000000000"), "1700000000000000000");
  assert.throws(() => validateNonce("1e6"), /ASCII digits/);
  assert.throws(() => validateNonce("10000000000000000000"), /1 to 19/);
});

test("the canonical payload signs the cleaned text", () => {
  assert.deepEqual(canonicalMessage("ci", "7", " build\npassed "), {
    room: "ci",
    nonce: "7",
    text: "build passed",
    payload: "ci|7|build passed",
  });
});
