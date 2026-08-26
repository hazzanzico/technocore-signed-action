import { createPublicKey, verify } from "node:crypto";
import { canonicalMessage } from "./canonical.js";

export const RECEIPT_SCHEMA = "technocore-signed-message-receipt-v1";

const DID_PREFIX = "did:key:z";
const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  Array.from(BASE58_ALPHABET, (character, index) => [character, BigInt(index)]),
);
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`receipt ${name} must be a non-empty string`);
  }
  return value;
}

function base58Decode(value) {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new Error("receipt DID contains invalid base58btc data");
    number = number * 58n + digit;
  }

  const decoded = [];
  while (number > 0n) {
    decoded.push(Number(number % 256n));
    number /= 256n;
  }
  decoded.reverse();

  let leadingZeroes = 0;
  for (const character of value) {
    if (character !== "1") break;
    leadingZeroes += 1;
  }
  return Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(decoded)]);
}

function publicKeyFromDid(value) {
  const did = requiredString(value, "did");
  if (!did.startsWith(DID_PREFIX)) {
    throw new Error("receipt DID must use the Ed25519 did:key format");
  }
  const decoded = base58Decode(did.slice(DID_PREFIX.length));
  if (
    decoded.length !== 34 ||
    !decoded.subarray(0, 2).equals(ED25519_MULTICODEC_PREFIX)
  ) {
    throw new Error("receipt DID must contain a canonical Ed25519 public key");
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, decoded.subarray(2)]),
    format: "der",
    type: "spki",
  });
}

export function verifyReceipt(value) {
  let receipt = value;
  if (typeof value === "string") {
    try {
      receipt = JSON.parse(value);
    } catch (error) {
      throw new Error("receipt must be valid JSON", { cause: error });
    }
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("receipt must be a JSON object");
  }
  if (receipt.schema !== RECEIPT_SCHEMA) {
    throw new Error(`receipt schema must be ${RECEIPT_SCHEMA}`);
  }

  const canonical = canonicalMessage(receipt.room, receipt.nonce, receipt.text);
  if (canonical.text !== receipt.text) {
    throw new Error("receipt text is not in canonical stored form");
  }
  const signature = requiredString(receipt.sig, "sig");
  if (!SIGNATURE_PATTERN.test(signature)) {
    throw new Error("receipt sig must be an unpadded 86-character base64url signature");
  }
  const rawSignature = Buffer.from(signature, "base64url");
  if (rawSignature.length !== 64) throw new Error("receipt sig must decode to 64 bytes");

  if (!POSITIVE_INTEGER_PATTERN.test(String(receipt.seq ?? ""))) {
    throw new Error("receipt seq must be a positive decimal string");
  }
  requiredString(receipt.ts, "ts");
  requiredString(receipt.record_url, "record_url");

  const valid = verify(
    null,
    Buffer.from(canonical.payload, "utf8"),
    publicKeyFromDid(receipt.did),
    rawSignature,
  );
  if (!valid) throw new Error("receipt signature does not match its DID and signed payload");
  return true;
}

export function createReceipt(result) {
  const receipt = {
    schema: RECEIPT_SCHEMA,
    did: result.did,
    room: result.room,
    nonce: result.nonce,
    text: result.text,
    sig: result.signature,
    seq: result.seq,
    ts: result.timestamp,
    record_url: result.recordUrl,
  };
  verifyReceipt(receipt);
  return Object.freeze(receipt);
}

export function serializeReceipt(result) {
  return JSON.stringify(createReceipt(result));
}
