import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAction } from "../src/action.js";
import { identityFromSeed } from "../src/identity.js";
import { resetAutomaticNonceForTests } from "../src/nonce.js";
import { readBody, sendJson, startServer } from "./helpers.js";

const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const DID = identityFromSeed(SEED).did;
const root = fileURLToPath(new URL("../", import.meta.url));
const emptyRoom = () => new Response('{"messages":[]}');
const environment = () => ({
  INPUT_SEED: SEED, INPUT_ROOM: "ci", INPUT_TEXT: "build\npassed",
  INPUT_BASE_URL: "http://localhost:1234", INPUT_TIMEOUT_MS: "100",
});
const record = (body) => ({
  from: body.did, nonce: body.nonce, text: body.text,
  seq: 12, ts: "2026-09-13T12:00:00Z",
});

test("an explicit padded nonce is normalized before logging, signing, and confirmation", async () => {
  const attempts = [];
  const result = await runAction({
    env: { ...environment(), INPUT_NONCE: "0000000000000000042" },
    attemptReporter: (attempt) => attempts.push(attempt), outputWriter: () => {},
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "POST", "a valid response must not require recovery");
      const body = JSON.parse(options.body);
      // Technocore app.py verifies the string, then store.append stores int(nonce).
      return Response.json({ posted: { ...record(body), nonce: Number(body.nonce) } });
    },
  });
  assert.equal(result.nonce, "42");
  assert.equal(attempts[0].nonce, "42");
  assert.equal(JSON.parse(result.receipt_json).nonce, "42");
});

for (const failure of ["network", "503", "malformed", "mismatch", "read-failure"]) {
  test(`attempt identity is reported before an unconfirmed ${failure} write`, async () => {
    resetAutomaticNonceForTests();
    const attempts = [];
    let posts = 0;
    let outputs = 0;
    const env = environment();
    await assert.rejects(runAction({
      env,
      attemptReporter: async (attempt) => { attempts.push(attempt); },
      outputWriter: () => { outputs += 1; },
      fetchImpl: async (_url, options) => {
        if (options.method !== "POST") {
          if (failure === "read-failure") throw new Error("read unavailable");
          return emptyRoom();
        }
        posts += 1;
        const body = JSON.parse(options.body);
        assert.deepEqual(attempts, [{ did: DID, room: "ci", nonce: body.nonce }]);
        assert.equal("INPUT_SEED" in env, false);
        if (failure === "network" || failure === "read-failure") throw new Error("offline");
        if (failure === "503") return new Response("unavailable", { status: 503 });
        if (failure === "mismatch") return Response.json({ posted: { ...record(body), text: "wrong" } });
        return new Response("broken JSON");
      },
    }), (error) => error.outcomeUnknown === true);
    assert.equal(posts, 1);
    assert.equal(outputs, 0);
    assert.match(attempts[0].nonce, /^[0-9]{1,19}$/);
    assert.equal(JSON.stringify(attempts).includes(SEED), false);
  });
}

test("a replacement automatic nonce is reported before the second, uncertain POST", async () => {
  resetAutomaticNonceForTests();
  const attempts = [];
  const posts = [];
  await assert.rejects(runAction({
    env: environment(),
    attemptReporter: (attempt) => attempts.push(attempt),
    outputWriter: () => assert.fail("uncertain write has no success outputs"),
    fetchImpl: async (_url, options) => {
      if (options.method !== "POST") return emptyRoom();
      const body = JSON.parse(options.body);
      posts.push(body);
      assert.equal(attempts.length, posts.length);
      assert.equal(attempts.at(-1).nonce, body.nonce);
      if (posts.length === 1) return new Response(
        `nonce ${body.nonce} is not greater than 9999999999999999997`, { status: 400 });
      throw new Error("lost second response");
    },
  }), (error) => error.outcomeUnknown === true);
  assert.equal(posts.length, 2);
  assert.equal(attempts[1].nonce, "9999999999999999998");
});

test("failed attempt reporting prevents the POST", async () => {
  resetAutomaticNonceForTests();
  let requests = 0;
  await assert.rejects(runAction({
    env: environment(),
    attemptReporter: async () => { throw new Error("log unavailable"); },
    fetchImpl: async () => { requests += 1; throw new Error("unexpected request"); },
  }), /log unavailable/);
  assert.equal(requests, 0);
});

for (const status of [403, 503]) {
  test(`stale-looking HTTP ${status} does not trigger another POST`, async () => {
    resetAutomaticNonceForTests();
    let posts = 0;
    await assert.rejects(runAction({
      env: environment(), attemptReporter: () => {},
      fetchImpl: async (_url, options) => {
        if (options.method !== "POST") return emptyRoom();
        posts += 1;
        const body = JSON.parse(options.body);
        return new Response(`nonce ${body.nonce} is not greater than 9999999999999999997`, { status });
      },
    }), (error) => error.status === status && error.outcomeUnknown === (status >= 500));
    assert.equal(posts, 1);
  });
}

for (const invalid of [{ seq: 0 }, { seq: 1.5 }, { ts: "" }, { ts: null }]) {
  test(`a matching read with invalid metadata ${JSON.stringify(invalid)} remains uncertain`, async () => {
    let body;
    await assert.rejects(runAction({
      env: { ...environment(), INPUT_NONCE: "1700000000000000999" },
      attemptReporter: () => {},
      fetchImpl: async (_url, options) => {
        if (options.method === "POST") { body = JSON.parse(options.body); throw new Error("lost"); }
        return Response.json({ messages: [{ ...record(body), ...invalid }] });
      },
    }), (error) => error.outcomeUnknown === true);
  });
}

test("the request deadline includes consumption of the response body", async () => {
  resetAutomaticNonceForTests();
  let posts = 0;
  const started = Date.now();
  await assert.rejects(runAction({
    env: environment(), attemptReporter: () => {},
    fetchImpl: async (_url, options) => {
      if (options.method !== "POST") return emptyRoom();
      posts += 1;
      return { ok: true, status: 200, text: () => new Promise((resolve, reject) => {
        const fallback = setTimeout(() => resolve("broken JSON"), 1000);
        options.signal.addEventListener("abort", () => {
          clearTimeout(fallback); reject(new Error("body aborted"));
        }, { once: true });
      }) };
    },
  }), (error) => error.outcomeUnknown === true);
  assert.equal(posts, 1);
  assert.ok(Date.now() - started < 900, "response body must not outlive the 100ms request deadline");
});

for (const scenario of ["network", "503", "malformed", "success", "reconciled", "body-timeout"]) {
  test(`the actual Action entry point reports recoverable metadata on ${scenario}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "technocore-recovery-"));
    const outputFile = join(directory, "outputs");
    let attempted;
    let posts = 0;
    const server = await startServer(async (request, response) => {
      if (request.method === "GET") {
        sendJson(response, JSON.stringify({ messages: scenario === "reconciled" ? [record(attempted)] : [] }));
        return;
      }
      posts += 1;
      attempted = JSON.parse(await readBody(request));
      if (scenario === "network") { request.socket.destroy(); return; }
      if (scenario === "body-timeout") {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"posted":');
        const fallback = setTimeout(() => response.end("null}"), 3000);
        response.once("close", () => clearTimeout(fallback));
        return;
      }
      if (scenario === "503" || scenario === "reconciled") { sendJson(response, "unavailable", 503); return; }
      if (scenario === "malformed") { sendJson(response, "broken JSON"); return; }
      sendJson(response, JSON.stringify({ posted: record(attempted) }));
    });
    try {
      const child = spawn(process.execPath, ["src/index.js"], {
        cwd: root, env: { ...process.env, ...environment(), INPUT_BASE_URL: server.baseUrl,
          INPUT_TIMEOUT_MS: "1000", GITHUB_OUTPUT: outputFile },
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", resolve);
      });
      const success = scenario === "success" || scenario === "reconciled";
      assert.equal(code, success ? 0 : 1);
      assert.equal(posts, 1);
      const line = stdout.split(/\r?\n/).find((value) => value.startsWith("Technocore write attempt: "));
      assert.ok(line, "failed steps must leave public lookup metadata in the step log");
      assert.deepEqual(JSON.parse(line.slice("Technocore write attempt: ".length)), {
        did: DID, room: "ci", nonce: attempted.nonce,
      });
      const outputs = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
      assert.equal(outputs.includes("record_url="), success);
      assert.equal((stdout + stderr + outputs).includes(SEED), false);
      assert.equal(stdout.includes("Signed Technocore record"), success);
    } finally {
      await server.close(); rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const refusal of ["explicit", "wrong-nonce", "lower-floor", "second-refusal"]) {
  test(`${refusal} stale response cannot cause an extra POST`, async () => {
    resetAutomaticNonceForTests();
    let posts = 0;
    const env = environment();
    if (refusal === "explicit") env.INPUT_NONCE = "1700000000000000900";
    await assert.rejects(runAction({
      env, attemptReporter: () => {},
      fetchImpl: async (_url, options) => {
        posts += 1;
        const body = JSON.parse(options.body);
        const nonce = refusal === "wrong-nonce" ? "42" : body.nonce;
        const floor = refusal === "lower-floor" ? "1" : "9999999999999999997";
        return new Response(`nonce ${nonce} is not greater than ${floor}`, { status: 400 });
      },
    }), (error) => error.status === 400 && !error.outcomeUnknown);
    assert.equal(posts, refusal === "second-refusal" ? 2 : 1);
  });
}

test("successful replacement nonce agrees across logs, outputs, and receipt", async () => {
  resetAutomaticNonceForTests();
  const attempts = [];
  const result = await runAction({
    env: environment(), attemptReporter: (attempt) => attempts.push(attempt),
    outputWriter: () => {},
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (attempts.length === 1) return new Response(
        `nonce ${body.nonce} is not greater than 9999999999999999997`, { status: 400 });
      return Response.json({ posted: record(body) });
    },
  });
  assert.equal(attempts.length, 2);
  assert.equal(result.nonce, attempts[1].nonce);
  assert.equal(JSON.parse(result.receipt_json).nonce, attempts[1].nonce);
});

for (const readResult of ["503", "bad-json", "wrong-did", "wrong-nonce", "wrong-text", "no-messages"]) {
  test(`confirmation read ${readResult} cannot confirm a write or cause another POST`, async () => {
    let posts = 0;
    let body;
    await assert.rejects(runAction({
      env: { ...environment(), INPUT_NONCE: "1700000000000000999" }, attemptReporter: () => {},
      fetchImpl: async (_url, options) => {
        if (options.method === "POST") {
          posts += 1; body = JSON.parse(options.body); throw new Error("lost");
        }
        if (readResult === "503") return new Response("unavailable", { status: 503 });
        if (readResult === "bad-json") return new Response("broken JSON");
        if (readResult === "no-messages") return Response.json({});
        const found = record(body);
        if (readResult === "wrong-did") found.from = "other";
        if (readResult === "wrong-nonce") found.nonce = "2";
        if (readResult === "wrong-text") found.text = "different";
        return Response.json({ messages: [found] });
      },
    }), (error) => error.outcomeUnknown === true);
    assert.equal(posts, 1);
  });
}

test("invalid inputs fail before attempt logging or network activity", async () => {
  const env = environment();
  env.INPUT_ROOM = "bad\n::error::room";
  await assert.rejects(runAction({
    env,
    attemptReporter: () => assert.fail("must validate before logging"),
    fetchImpl: () => assert.fail("must validate before network"),
  }), /room must start/);
  assert.equal("INPUT_SEED" in env, false);
});
