import test from "node:test";
import assert from "node:assert/strict";
import { automaticNonce, resetAutomaticNonceForTests } from "../src/nonce.js";

test("automatic nonces are monotonic even when the clock does not advance", () => {
  resetAutomaticNonceForTests();
  const first = automaticNonce(0n, () => 1_700_000_000_000, () => 10n);
  const second = automaticNonce(0n, () => 1_700_000_000_000, () => 10n);
  assert.equal(first, "1700000000000000010");
  assert.equal(second, "1700000000000000011");
});
test("a server floor takes priority over the local clock", () => {
  resetAutomaticNonceForTests();
  assert.equal(
    automaticNonce(9_999_999_999_999_999_990n, () => 1, () => 0n),
    "9999999999999999991",
  );
});

test("the maximum nonce cannot be incremented", () => {
  resetAutomaticNonceForTests();
  assert.throws(
    () => automaticNonce(9_999_999_999_999_999_999n, () => 1, () => 0n),
    /cannot create a nonce/,
  );
});
