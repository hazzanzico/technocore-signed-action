import { appendFileSync } from "node:fs";
import { identityFromSeed } from "./identity.js";
import { postSignedMessage } from "./client.js";
import { serializeReceipt } from "./receipt.js";

function input(env, name, { required = false } = {}) {
  const key = `INPUT_${name.toUpperCase()}`;
  const value = env[key] ?? "";
  if (required && String(value).trim() === "") throw new Error(`missing required input: ${name}`);
  return value;
}

function oneLine(value, name) {
  const rendered = String(value);
  if (/[\r\n]/.test(rendered)) throw new Error(`refusing multiline GitHub output: ${name}`);
  return rendered;
}

export function writeOutputs(outputs, outputFile) {
  if (!outputFile) throw new Error("GITHUB_OUTPUT is not available");
  const rows = Object.entries(outputs).map(([name, value]) => `${name}=${oneLine(value, name)}\n`);
  appendFileSync(outputFile, rows.join(""), { encoding: "utf8" });
}

export async function runAction({
  env = process.env,
  fetchImpl = globalThis.fetch,
  outputWriter = writeOutputs,
  attemptReporter = (attempt) => console.log(`Technocore write attempt: ${JSON.stringify(attempt)}`),
} = {}) {
  let seed = input(env, "seed", { required: true });
  let identity;
  try {
    identity = identityFromSeed(seed);
  } finally {
    seed = "";
    delete env.INPUT_SEED;
  }

  const result = await postSignedMessage({
    identity,
    room: input(env, "room", { required: true }),
    text: input(env, "text", { required: true }),
    baseUrl: input(env, "base_url") || "https://technocore.chat",
    nonce: input(env, "nonce"),
    timeoutMs: input(env, "timeout_ms") || "30000",
    fetchImpl,
    onAttempt: attemptReporter,
  });

  const outputs = {
    did: result.did,
    room: result.room,
    seq: result.seq,
    timestamp: result.timestamp,
    nonce: result.nonce,
    canonical_text: result.text,
    signature: result.signature,
    receipt_json: serializeReceipt(result),
    record_url: result.recordUrl,
    api_url: result.apiUrl,
  };
  outputWriter(outputs, env.GITHUB_OUTPUT);
  return outputs;
}
