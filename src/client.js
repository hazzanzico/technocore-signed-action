import { canonicalMessage, cleanText, validateNonce, validateRoom } from "./canonical.js";
import { automaticNonce } from "./nonce.js";

const DEFAULT_BASE_URL = "https://technocore.chat";
const USER_AGENT = "technocore-signed-action/0.2.0";
const STALE_NONCE = /nonce\s+([0-9]{1,19})\s+is not greater than\s+([0-9]{1,19})/i;
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
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    // The deadline must cover the body too: receiving headers does not finish a write.
    return { ok: response.ok, status: response.status, raw: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function postOnce({ fetchImpl, url, envelope, timeoutMs }) {
  return fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "user-agent": USER_AGENT,
      },
      body: signedBody(envelope),
    },
    timeoutMs,
  );
}

function matchesRecord(posted, expected) {
  return Boolean(
    posted &&
    Number.isSafeInteger(posted.seq) && posted.seq > 0 &&
    typeof posted.ts === "string" && posted.ts.length > 0 &&
    posted.from === expected.did &&
    String(posted.nonce) === expected.nonce &&
    posted.text === expected.text
  );
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
  if (!matchesRecord(posted, expected)) {
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
    { headers: { accept: "application/json", "user-agent": USER_AGENT } },
    timeoutMs,
  );
  if (!response.ok) return null;
  let payload;
  try {
    payload = parseJsonPreservingNonce(response.raw);
  } catch {
    return null;
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages.find((message) => matchesRecord(message, expected)) ?? null;
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
    text: expected.text,
    signature: expected.signature,
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
  onAttempt,
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
  // The service stores int(nonce). Sign its canonical decimal form so response
  // matching and the operator's logged lookup value agree even for padded input.
  let nonce = automatic ? automaticNonce() : BigInt(validateNonce(explicitNonce)).toString();
  const roomUrl = new URL(`r/${encodeURIComponent(room)}`, baseUrl);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const envelope = prepare(identity, room, text, nonce);
    // Publish only safe lookup fields, before every attempt (including a replacement nonce).
    // Keep reporting outside the network catch: failure here must prevent the POST.
    await onAttempt?.({ did: envelope.did, room: envelope.room, nonce: envelope.nonce });
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
      try {
        const posted = validatePosted(response.raw, envelope);
        return resultFrom(posted, envelope, baseUrl);
      } catch (error) {
        if (!(error instanceof TechnocoreError) || !error.outcomeUnknown) throw error;
        let found = null;
        try {
          found = await reconcile({ fetchImpl, roomUrl, expected: envelope, timeoutMs: timeout });
        } catch {
          // The success body was unusable and the confirmation read also failed.
        }
        if (found) return resultFrom(found, envelope, baseUrl);
        throw error;
      }
    }

    const stale = response.raw.match(STALE_NONCE);
    if (
      response.status === 400 && automatic && attempt === 0 && stale &&
      stale[1] === nonce && BigInt(stale[2]) >= BigInt(nonce)
    ) {
      nonce = automaticNonce(BigInt(stale[2]));
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
