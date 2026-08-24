import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAction, writeOutputs } from "../src/action.js";
import { identityFromSeed } from "../src/identity.js";
import { jsonRecord, nonceFromJson, readBody, sendJson, startServer } from "./helpers.js";

const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

test("the Action deletes the seed input and exposes only public record outputs", async () => {
  const identity = identityFromSeed(SEED);
  const server = await startServer(async (request, response) => {
    const raw = await readBody(request);
    assert.equal(raw.includes(SEED), false);
    const parsed = JSON.parse(raw);
    const nonce = nonceFromJson(raw);
    sendJson(
      response,
      jsonRecord({
        room: "ci",
        seq: 11,
        timestamp: "2026-08-24T21:00:00Z",
        did: identity.did,
        text: parsed.text,
        nonce,
      }),
    );
  });
  const env = {
    INPUT_SEED: SEED,
    INPUT_ROOM: "ci",
    INPUT_TEXT: "tests passed",
    INPUT_BASE_URL: server.baseUrl,
    INPUT_NONCE: "1700000000000000500",
    INPUT_TIMEOUT_MS: "1000",
    GITHUB_OUTPUT: "unused-in-this-test",
  };
  let captured;
  try {
    const outputs = await runAction({
      env,
      outputWriter(value) {
        captured = value;
      },
    });
    assert.equal("INPUT_SEED" in env, false);
    assert.equal(outputs.did, identity.did);
    assert.equal(outputs.seq, "11");
    assert.deepEqual(captured, outputs);
    assert.equal(JSON.stringify(outputs).includes(SEED), false);
  } finally {
    await server.close();
  }
});

test("the output writer uses the GitHub output file and refuses multiline values", () => {
  const directory = mkdtempSync(join(tmpdir(), "technocore-action-test-"));
  const outputFile = join(directory, "outputs.txt");
  try {
    writeOutputs({ did: "did:key:zExample", seq: "7" }, outputFile);
    assert.equal(readFileSync(outputFile, "utf8"), "did=did:key:zExample\nseq=7\n");
    assert.throws(() => writeOutputs({ unsafe: "line1\nline2" }, outputFile), /multiline/);
    assert.throws(() => writeOutputs({ did: "x" }, ""), /GITHUB_OUTPUT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an invalid seed is removed from the environment before the Action fails", async () => {
  const env = { INPUT_SEED: "not-a-key" };
  await assert.rejects(runAction({ env }), /seed must be exactly 32 bytes/);
  assert.equal("INPUT_SEED" in env, false);
});
