import { MAX_NONCE, validateNonce } from "./canonical.js";

let lastAutomaticNonce = 0n;

export function automaticNonce(floor = 0n, clock = Date.now, fineClock = process.hrtime.bigint) {
  const parsedFloor = typeof floor === "bigint" ? floor : BigInt(validateNonce(floor));
  const fine = fineClock() % 1_000_000n;
  let candidate = BigInt(clock()) * 1_000_000n + fine;
  if (candidate <= parsedFloor) candidate = parsedFloor + 1n;
  if (candidate <= lastAutomaticNonce) candidate = lastAutomaticNonce + 1n;
  if (candidate > MAX_NONCE) {
    throw new Error("cannot create a nonce above Technocore's 19-digit maximum");
  }
  lastAutomaticNonce = candidate;
  return candidate.toString();
}
export function resetAutomaticNonceForTests() {
  lastAutomaticNonce = 0n;
}
