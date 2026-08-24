import test from "node:test";
import assert from "node:assert/strict";
import { identityFromSeed } from "../src/identity.js";
import { verifySignature } from "./helpers.js";

const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

test("derivation and signing match the official Technocore Python implementation", () => {
  const identity = identityFromSeed(SEED);
  const payload = "ci|1700000000000000000|build passed";
  assert.equal(
    identity.did,
    "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd",
  );
  assert.equal(
    identity.sign(payload),
    "SDtbB8hUc4lQIbG6TtulP2PsB8gAr2650wRGxhBWsfLi5M7K0eIbFA6Dllv9Xh_gQ3rRp43yKv1u0F4ZTyDQAA",
  );
  assert.equal(verifySignature(identity.publicKey, identity.sign(payload), payload), true);
});
test("invalid or padded seeds are refused", () => {
  assert.throws(() => identityFromSeed("00"), /exactly 32 bytes/);
  assert.throws(() => identityFromSeed(`${SEED}00`), /exactly 32 bytes/);
  assert.throws(() => identityFromSeed("g".repeat(64)), /hexadecimal/);
});
