import { canonicalMessage, cleanText, validateNonce, validateRoom } from "./canonical.js";
import { automaticNonce } from "./nonce.js";

const DEFAULT_BASE_URL = "https://technocore.chat";
const STALE_NONCE = /nonce\s+[0-9]{1,19}\s+is not greater than\s+([0-9]{1,19})/i;
const UNSAFE_LOG_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

export class TechnocoreError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "TechnocoreError";
    this.outcomeUnknown = Boolean(options.outcomeUnknown);
    this.status = options.status;
  }
}

export function validateBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_BASE_URL));
  } catch {
    throw new Error("base-url must be a valid absolute URL");
  }

  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("base-url must use HTTPS; plain HTTP is allowed only for localhost tests");
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function parseJsonPreservingNonce(raw) {
  const protectedJson = String(raw).replace(
    /("nonce"\s*:\s*)([0-9]{1,19})(?=\s*[,}])/g,
    '$1"$2"',
  );
  return JSON.parse(protectedJson);
}

function signedBody({ did, signature, nonce, text }) {
  return JSON.stringify({ did, sig: signature, nonce, text });
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function postOnce({ fetchImpl, url, envelope, timeoutMs }) {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "user-agent": "technocore-signed-action/0.1",
      },
      body: signedBody(envelope),
    },
    timeoutMs,
  );
  const raw = await response.text();
  return { ok: response.ok, status: response.status, raw };
}

function validatePosted(raw, expected) {
  let payload;
  try {
    payload = parseJsonPreservingNonce(raw);
  } catch (error) {
    throw new TechnocoreError("Technocore returned malformed JSON after accepting the write", {
      cause: error,
      outcomeUnknown: true,
    });
  }
  const posted = payload?.posted;
  if (
    !posted ||
    !Number.isSafeInteger(posted.seq) ||
    posted.seq < 1 ||
    typeof posted.ts !== "string" ||
    posted.from !== expected.did ||
    String(posted.nonce) !== expected.nonce ||
    posted.text !== expected.text
  ) {
    throw new TechnocoreError("Technocore accepted the request but returned an unexpected record", {
      outcomeUnknown: true,
    });
  }
  return posted;
}

async function reconcile({ fetchImpl, roomUrl, expected, timeoutMs }) {
  const readUrl = new URL(roomUrl);
  readUrl.searchParams.set("limit", "200");
  readUrl.searchParams.set("format", "json");
  const response = await fetchWithTimeout(
    fetchImpl,
    readUrl,
    { headers: { accept: "application/json", "user-agent": "technocore-signed-action/0.1" } },
    timeoutMs,
  );
  if (!response.ok) return null;
  const raw = await response.text();
  let payload;
  try {
    payload = parseJsonPreservingNonce(raw);
  } catch {
    return null;
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return (
    messages.find(
      (message) =>
        message?.from === expected.did &&
        String(message?.nonce) === expected.nonce &&
        message?.text === expected.text,
    ) ?? null
  );
}

function resultFrom(posted, expected, baseUrl) {
  const roomPath = `r/${encodeURIComponent(expected.room)}`;
  const recordUrl = new URL(`humans#r/${expected.room}/${posted.seq}`, baseUrl).toString();
  const apiUrl = new URL(roomPath, baseUrl);
  apiUrl.searchParams.set("since", String(Math.max(0, posted.seq - 1)));
  apiUrl.searchParams.set("limit", "200");
  apiUrl.searchParams.set("format", "json");
  return {
    did: expected.did,
    room: expected.room,
    seq: String(posted.seq),
    timestamp: posted.ts,
    nonce: expected.nonce,
    recordUrl,
    apiUrl: apiUrl.toString(),
  };
}

function prepare(identity, room, text, nonce) {
  const canonical = canonicalMessage(room, nonce, text);
  return {
    did: identity.did,
    room: canonical.room,
    nonce: canonical.nonce,
    text: canonical.text,
    signature: identity.sign(canonical.payload),
  };
}

export async function postSignedMessage({
  identity,
  room: roomValue,
  text: textValue,
  baseUrl: baseUrlValue = DEFAULT_BASE_URL,
  nonce: explicitNonce,
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
}) {
  if (!identity?.did || typeof identity.sign !== "function") {
    throw new Error("a signing identity is required");
  }
  if (typeof fetchImpl !== "function") throw new Error("a fetch implementation is required");

  const room = validateRoom(roomValue);
  const text = cleanText(textValue);
  const baseUrl = validateBaseUrl(baseUrlValue);
  const timeout = Number(timeoutMs);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 300_000) {
    throw new Error("timeout-ms must be an integer from 100 through 300000");
  }

  const automatic = explicitNonce === undefined || String(explicitNonce).trim() === "";
  let nonce = automatic ? automaticNonce() : validateNonce(explicitNonce);
  const roomUrl = new URL(`r/${encodeURIComponent(room)}`, baseUrl);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const envelope = prepare(identity, room, text, nonce);
    let response;
    try {
      response = await postOnce({ fetchImpl, url: roomUrl, envelope, timeoutMs: timeout });
    } catch (error) {
      let found = null;
      try {
        found = await reconcile({ fetchImpl, roomUrl, expected: envelope, timeoutMs: timeout });
      } catch {
        // The POST may have landed. A failed read cannot prove otherwise.
      }
      if (found) return resultFrom(found, envelope, baseUrl);
      throw new TechnocoreError(
        "Technocore write outcome is unknown after a network failure; check the room before retrying",
        { cause: error, outcomeUnknown: true },
      );
    }

    if (response.ok) {
      const posted = validatePosted(response.raw, envelope);
      return resultFrom(posted, envelope, baseUrl);
    }

    const stale = response.raw.match(STALE_NONCE);
    if (automatic && attempt === 0 && stale) {
      nonce = automaticNonce(BigInt(stale[1]));
      continue;
    }

    if (response.status >= 500) {
      let found = null;
      try {
        found = await reconcile({ fetchImpl, roomUrl, expected: envelope, timeoutMs: timeout });
      } catch {
        // Preserve the unknown outcome below.
      }
      if (found) return resultFrom(found, envelope, baseUrl);
      throw new TechnocoreError(
        `Technocore returned HTTP ${response.status}; the write outcome is unknown, so check the room before retrying`,
        { status: response.status, outcomeUnknown: true },
      );
    }

    const detail = Array.from(
      response.raw.replace(UNSAFE_LOG_CHARACTERS, " ").trim().replace(/\s+/g, " "),
    )
      .slice(0, 500)
      .join("");
    throw new TechnocoreError(
      `Technocore refused the signed write with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      { status: response.status },
    );
  }

  throw new TechnocoreError("Technocore rejected the replacement nonce");
}
