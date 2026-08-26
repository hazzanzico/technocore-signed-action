import test from "node:test";
import assert from "node:assert/strict";
import { createReceipt, serializeReceipt, verifyReceipt } from "../src/receipt.js";
import { identityFromSeed } from "../src/identity.js";

const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const identity = identityFromSeed(SEED);
const baseResult = {
  did: identity.did,
  room: "ci",
  nonce: "1700000000000000000",
  text: "build passed",
  signature: identity.sign("ci|1700000000000000000|build passed"),
  seq: "42",
  timestamp: "2026-08-26T08:00:00Z",
  recordUrl: "https://technocore.chat/humans#r/ci/42",
};

test("a portable receipt verifies without the private seed or server", () => {
  const receipt = createReceipt(baseResult);
  assert.equal(verifyReceipt(receipt), true);
  assert.equal(verifyReceipt(serializeReceipt(baseResult)), true);
  assert.equal(JSON.stringify(receipt).includes(SEED), false);
  assert.equal(serializeReceipt(baseResult).includes("\n"), false);
});

test("signed fields cannot be changed without invalidating the receipt", () => {
  const receipt = createReceipt(baseResult);
  for (const change of [
    { room: "release" },
    { nonce: "1700000000000000001" },
    { text: "build failed" },
  ]) {
    assert.throws(() => verifyReceipt({ ...receipt, ...change }), /signature does not match/);
  }
});

test("receipt shape, DID, signature, and canonical text are validated", () => {
  const receipt = createReceipt(baseResult);
  assert.throws(() => verifyReceipt("not json"), /valid JSON/);
  assert.throws(() => verifyReceipt([]), /JSON object/);
  assert.throws(() => verifyReceipt({ ...receipt, schema: "future" }), /schema/);
  assert.throws(() => verifyReceipt({ ...receipt, did: "did:key:zbad" }), /Ed25519/);
  assert.throws(() => verifyReceipt({ ...receipt, sig: "bad" }), /86-character/);
  assert.throws(() => verifyReceipt({ ...receipt, text: "build\npassed" }), /canonical stored form/);
  assert.throws(() => verifyReceipt({ ...receipt, seq: "0" }), /positive decimal/);
  assert.throws(() => verifyReceipt({ ...receipt, ts: "" }), /non-empty/);
});

test("server sequence and timestamp are observations, not signed fields", () => {
  const receipt = createReceipt(baseResult);
  assert.equal(verifyReceipt({ ...receipt, seq: "43" }), true);
  assert.equal(verifyReceipt({ ...receipt, ts: "2026-08-26T08:01:00Z" }), true);
});
