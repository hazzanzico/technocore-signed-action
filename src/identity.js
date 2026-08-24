import { createPrivateKey, createPublicKey, sign } from "node:crypto";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SEED_PATTERN = /^[0-9a-fA-F]{64}$/;

function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    value /= 58n;
  }

  let leadingZeroes = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeroes += 1;
  }
  return "1".repeat(leadingZeroes) + encoded;
}
export function identityFromSeed(seedHex) {
  const normalized = String(seedHex ?? "").trim();
  if (!SEED_PATTERN.test(normalized)) {
    throw new Error("seed must be exactly 32 bytes encoded as 64 hexadecimal characters");
  }

  const rawSeed = Buffer.from(normalized, "hex");
  let privateKey;
  try {
    privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, rawSeed]),
      format: "der",
      type: "pkcs8",
    });
  } finally {
    rawSeed.fill(0);
  }

  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKey = Buffer.from(spki.subarray(spki.length - 32));
  const did = `did:key:z${base58Encode(Buffer.concat([ED25519_MULTICODEC_PREFIX, publicKey]))}`;

  return Object.freeze({
    did,
    publicKey,
    sign(payload) {
      return sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");
    },
  });
}
