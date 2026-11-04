import { createHmac, timingSafeEqual } from "node:crypto";

/** `buyerId` + HMAC, so a client cannot claim another buyer by typing their id. */
export function signBuyerToken(buyerId: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(buyerId).digest("base64url");
  return `${buyerId}.${sig}`;
}

export function verifyBuyerToken(token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const buyerId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!buyerId || !sig || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(buyerId)) return null;

  const expected = createHmac("sha256", secret).update(buyerId).digest("base64url");
  const got = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return buyerId;
}

export function buyerIdFromAuthorization(header: string | undefined, secret: string): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  return verifyBuyerToken(match[1], secret);
}
