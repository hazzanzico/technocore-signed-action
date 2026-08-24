import test from "node:test";
import assert from "node:assert/strict";
import { postSignedMessage, TechnocoreError, validateBaseUrl } from "../src/client.js";
import { identityFromSeed } from "../src/identity.js";
import { resetAutomaticNonceForTests } from "../src/nonce.js";
import {
  jsonRecord,
  nonceFromJson,
  readBody,
  sendJson,
  startServer,
  verifySignature,
} from "./helpers.js";

const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const identity = identityFromSeed(SEED);
const timestamp = "2026-08-24T20:52:30.673433Z";

test("a signed POST contains an exact digit-string nonce and a verifiable envelope", async () => {
  let received = "";
  const server = await startServer(async (request, response) => {
    received = await readBody(request);
    const parsed = JSON.parse(received);
    const nonce = nonceFromJson(received);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/r/ci");
    assert.equal(parsed.did, identity.did);
    assert.equal(parsed.nonce, "1700000000000000000");
    assert.equal(
      verifySignature(identity.publicKey, parsed.sig, `ci|${nonce}|${parsed.text}`),
      true,
    );
    sendJson(
      response,
      jsonRecord({ room: "ci", seq: 7, timestamp, did: parsed.did, text: parsed.text, nonce }),
    );
  });
  try {
    const result = await postSignedMessage({
      identity,
      room: "ci",
      text: "build\npassed",
      nonce: "1700000000000000000",
      baseUrl: server.baseUrl,
    });
    assert.equal(result.seq, "7");
    assert.equal(result.nonce, "1700000000000000000");
    assert.match(result.recordUrl, /humans#r\/ci\/7$/);
    assert.match(result.apiUrl, /since=6/);
    assert.equal(received.includes(SEED), false);
  } finally {
    await server.close();
  }
});

test("an automatic nonce is re-signed once after a clear stale-nonce refusal", async () => {
  resetAutomaticNonceForTests();
  const seen = [];
  const floor = "9999999999999999997";
  const server = await startServer(async (request, response) => {
    const raw = await readBody(request);
    const parsed = JSON.parse(raw);
    const nonce = nonceFromJson(raw);
    seen.push(nonce);
    assert.equal(verifySignature(identity.publicKey, parsed.sig, `ci|${nonce}|passed`), true);
    if (seen.length === 1) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end(`nonce ${nonce} is not greater than ${floor}, the last one this key used in /r/ci`);
      return;
    }
    sendJson(
      response,
      jsonRecord({ room: "ci", seq: 8, timestamp, did: parsed.did, text: parsed.text, nonce }),
    );
  });
  try {
    const result = await postSignedMessage({
      identity,
      room: "ci",
      text: "passed",
      baseUrl: server.baseUrl,
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1], "9999999999999999998");
    assert.equal(result.nonce, seen[1]);
  } finally {
    await server.close();
  }
});

test("a timed-out POST is reconciled by reading the room instead of posting twice", async () => {
  const nonce = "1700000000000000200";
  let posts = 0;
  const server = await startServer(async (request, response) => {
    if (request.method === "GET") {
      sendJson(
        response,
        jsonRecord({
          room: "ci",
          seq: 9,
          timestamp,
          did: identity.did,
          text: "deployed",
          nonce,
          includePosted: false,
        }),
      );
      return;
    }
    posts += 1;
    await readBody(request);
    setTimeout(() => {
      if (!response.destroyed) {
        sendJson(
          response,
          jsonRecord({ room: "ci", seq: 9, timestamp, did: identity.did, text: "deployed", nonce }),
        );
      }
    }, 250);
  });
  try {
    const result = await postSignedMessage({
      identity,
      room: "ci",
      text: "deployed",
      nonce,
      baseUrl: server.baseUrl,
      timeoutMs: 100,
    });
    assert.equal(posts, 1);
    assert.equal(result.seq, "9");
  } finally {
    await server.close();
  }
});

test("an unconfirmed network failure is reported as an unknown outcome", async () => {
  const server = await startServer(async (request, response) => {
    if (request.method === "GET") {
      sendJson(response, '{"room":"ci","count":0,"messages":[]}');
      return;
    }
    await readBody(request);
    request.socket.destroy();
  });
  try {
    await assert.rejects(
      postSignedMessage({
        identity,
        room: "ci",
        text: "unknown",
        nonce: "1700000000000000300",
        baseUrl: server.baseUrl,
      }),
      (error) =>
        error instanceof TechnocoreError &&
        error.outcomeUnknown === true &&
        /check the room before retrying/.test(error.message),
    );
  } finally {
    await server.close();
  }
});

test("malformed success JSON is not presented as a confirmed record", async () => {
  const server = await startServer(async (request, response) => {
    await readBody(request);
    response.writeHead(200, { "content-type": "application/json" });
    response.end("not json");
  });
  try {
    await assert.rejects(
      postSignedMessage({
        identity,
        room: "ci",
        text: "unknown",
        nonce: "1700000000000000400",
        baseUrl: server.baseUrl,
      }),
      (error) => error instanceof TechnocoreError && error.outcomeUnknown === true,
    );
  } finally {
    await server.close();
  }
});

test("a malformed success body is reconciled when the exact record landed", async () => {
  const nonce = "1700000000000000425";
  const server = await startServer(async (request, response) => {
    if (request.method === "GET") {
      sendJson(
        response,
        jsonRecord({
          room: "ci",
          seq: 10,
          timestamp,
          did: identity.did,
          text: "accepted with a broken response",
          nonce,
          includePosted: false,
        }),
      );
      return;
    }
    await readBody(request);
    response.writeHead(200, { "content-type": "application/json" });
    response.end("not json");
  });
  try {
    const result = await postSignedMessage({
      identity,
      room: "ci",
      text: "accepted with a broken response",
      nonce,
      baseUrl: server.baseUrl,
    });
    assert.equal(result.seq, "10");
    assert.equal(result.nonce, nonce);
  } finally {
    await server.close();
  }
});

test("an unexpected success record is not presented as proof", async () => {
  const nonce = "1700000000000000450";
  const server = await startServer(async (request, response) => {
    await readBody(request);
    sendJson(
      response,
      jsonRecord({
        room: "ci",
        seq: 10,
        timestamp,
        did: identity.did,
        text: "different text",
        nonce,
      }),
    );
  });
  try {
    await assert.rejects(
      postSignedMessage({
        identity,
        room: "ci",
        text: "expected text",
        nonce,
        baseUrl: server.baseUrl,
      }),
      (error) =>
        error instanceof TechnocoreError &&
        error.outcomeUnknown === true &&
        /unexpected record/.test(error.message),
    );
  } finally {
    await server.close();
  }
});

test("a 5xx response is reconciled when the exact record landed", async () => {
  const nonce = "1700000000000000460";
  const server = await startServer(async (request, response) => {
    if (request.method === "GET") {
      sendJson(
        response,
        jsonRecord({
          room: "ci",
          seq: 12,
          timestamp,
          did: identity.did,
          text: "landed before 502",
          nonce,
          includePosted: false,
        }),
      );
      return;
    }
    await readBody(request);
    response.writeHead(502, { "content-type": "text/plain" });
    response.end("bad gateway");
  });
  try {
    const result = await postSignedMessage({
      identity,
      room: "ci",
      text: "landed before 502",
      nonce,
      baseUrl: server.baseUrl,
    });
    assert.equal(result.seq, "12");
  } finally {
    await server.close();
  }
});

test("an unreconciled 5xx remains an unknown outcome", async () => {
  const server = await startServer(async (request, response) => {
    if (request.method === "GET") {
      sendJson(response, '{"room":"ci","count":0,"messages":[]}');
      return;
    }
    await readBody(request);
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("unavailable");
  });
  try {
    await assert.rejects(
      postSignedMessage({
        identity,
        room: "ci",
        text: "maybe",
        nonce: "1700000000000000470",
        baseUrl: server.baseUrl,
      }),
      (error) =>
        error instanceof TechnocoreError &&
        error.status === 503 &&
        error.outcomeUnknown === true,
    );
  } finally {
    await server.close();
  }
});

test("a 4xx refusal is not retried and unsafe log characters are removed", async () => {
  let posts = 0;
  const server = await startServer(async (request, response) => {
    posts += 1;
    await readBody(request);
    response.writeHead(403, { "content-type": "text/plain" });
    response.end("not allowed\n\u001bhidden");
  });
  try {
    await assert.rejects(
      postSignedMessage({
        identity,
        room: "ci",
        text: "refused",
        nonce: "1700000000000000480",
        baseUrl: server.baseUrl,
      }),
      (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.outcomeUnknown, false);
        assert.equal(error.message.includes("\n"), false);
        assert.equal(error.message.includes("\u001b"), false);
        return true;
      },
    );
    assert.equal(posts, 1);
  } finally {
    await server.close();
  }
});

test("invalid client configuration fails before making a request", async () => {
  await assert.rejects(
    postSignedMessage({ identity: null, room: "ci", text: "x", fetchImpl: async () => {} }),
    /signing identity is required/,
  );
  await assert.rejects(
    postSignedMessage({ identity, room: "ci", text: "x", fetchImpl: null }),
    /fetch implementation is required/,
  );
  await assert.rejects(
    postSignedMessage({ identity, room: "ci", text: "x", timeoutMs: 99 }),
    /timeout-ms must be an integer/,
  );
});

test("plain HTTP is restricted to local test services", () => {
  assert.equal(validateBaseUrl("http://localhost:8080").protocol, "http:");
  assert.throws(() => validateBaseUrl("not a url"), /valid absolute URL/);
  assert.throws(() => validateBaseUrl("http://technocore.chat"), /must use HTTPS/);
  assert.equal(validateBaseUrl("https://technocore.chat").protocol, "https:");
});
