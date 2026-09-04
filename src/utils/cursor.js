import { createHmac, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../errors/application-error.js";

const DEFAULT_CURSOR_HMAC_SECRET = "dev-cursor-hmac-secret";

function getCursorSecret() {
  return process.env.CURSOR_HMAC_SECRET || DEFAULT_CURSOR_HMAC_SECRET;
}

function signPayload(payloadB64) {
  return createHmac("sha256", getCursorSecret())
    .update(payloadB64)
    .digest("base64url");
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function encodeCursor(productId) {
  const payloadB64 = Buffer.from(
    JSON.stringify({ version: 1, after: productId }),
    "utf8",
  ).toString("base64url");
  const signature = signPayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function decodeCursor(cursor) {
  try {
    if (typeof cursor !== "string" || !cursor.includes(".")) {
      throw new Error("Cursor is missing signature.");
    }

    const [payloadB64, signature, ...rest] = cursor.split(".");
    if (
      rest.length > 0 ||
      !payloadB64 ||
      !signature ||
      !/^[A-Za-z0-9_-]+$/.test(payloadB64) ||
      !/^[A-Za-z0-9_-]+$/.test(signature)
    ) {
      throw new Error("Cursor format is invalid.");
    }

    const expected = signPayload(payloadB64);
    if (!safeEqual(signature, expected)) {
      throw new Error("Cursor signature mismatch.");
    }

    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    );
    const keys = Object.keys(parsed).sort();
    if (
      parsed.version !== 1 ||
      typeof parsed.after !== "string" ||
      keys.length !== 2 ||
      keys[0] !== "after" ||
      keys[1] !== "version"
    ) {
      throw new Error("Cursor has an unsupported payload.");
    }

    return parsed.after;
  } catch {
    throw new ApplicationError(
      400,
      "Invalid cursor",
      "The cursor is malformed or is not supported by this server.",
      "invalid-cursor",
    );
  }
}
