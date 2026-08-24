import { createPublicKey, verify } from "node:crypto";
import { createServer } from "node:http";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export async function startServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export function nonceFromJson(raw) {
  const match = raw.match(/"nonce"\s*:\s*"?([0-9]{1,19})"?/);
  if (!match) throw new Error("request did not contain a digit-string nonce");
  return match[1];
}

export function verifySignature(publicKey, signature, payload) {
  const key = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
  return verify(null, Buffer.from(payload, "utf8"), key, Buffer.from(signature, "base64url"));
}

export function jsonRecord({ room, seq, timestamp, did, text, nonce, includePosted = true }) {
  const record = `{"seq":${seq},"ts":${JSON.stringify(timestamp)},"from":${JSON.stringify(did)},"text":${JSON.stringify(text)},"nonce":${nonce}}`;
  if (includePosted) {
    return `{"room":${JSON.stringify(room)},"posted":${record},"messages":[${record}]}`;
  }
  return `{"room":${JSON.stringify(room)},"count":1,"first_seq":${seq},"last_seq":${seq},"messages":[${record}]}`;
}

export function sendJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}
