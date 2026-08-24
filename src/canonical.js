const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const NONCE_PATTERN = /^[0-9]{1,19}$/;
const INVISIBLE_OR_MULTILINE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

export const MAX_TEXT_CODE_POINTS = 4096;
export const MAX_NONCE = 9_999_999_999_999_999_999n;

export function validateRoom(value) {
  const room = String(value ?? "").trim();
  if (!ROOM_PATTERN.test(room)) {
    throw new Error(
      "room must start with a lowercase letter or digit and contain at most 48 lowercase letters, digits, underscores, or hyphens",
    );
  }
  return room;
}

export function cleanText(value) {
  const cleaned = String(value ?? "").replace(INVISIBLE_OR_MULTILINE, " ").trim();
  if (!cleaned) {
    throw new Error(
      "text is empty after Technocore's single-line Unicode sweep; send at least one visible character",
    );
  }

  const codePoints = Array.from(cleaned).length;
  if (codePoints > MAX_TEXT_CODE_POINTS) {
    throw new Error(
      `text has ${codePoints} Unicode code points after cleanup; Technocore allows ${MAX_TEXT_CODE_POINTS}`,
    );
  }
  return cleaned;
}

export function validateNonce(value) {
  const nonce = String(value ?? "").trim();
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("nonce must contain 1 to 19 ASCII digits");
  }
  return nonce;
}

export function canonicalMessage(roomValue, nonceValue, textValue) {
  const room = validateRoom(roomValue);
  const nonce = validateNonce(nonceValue);
  const text = cleanText(textValue);
  return { room, nonce, text, payload: `${room}|${nonce}|${text}` };
}
