import "dotenv/config";
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Same bytes as src/orders/buyer-token.ts — buyerId plus HMAC(CURSOR_HMAC_SECRET). */
export function buyerToken(buyerId, secret = process.env.CURSOR_HMAC_SECRET) {
  if (!secret) {
    throw new Error("CURSOR_HMAC_SECRET is not set");
  }
  const id = String(buyerId);
  const sig = createHmac("sha256", secret).update(id).digest("base64url");
  return `${id}.${sig}`;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: node scripts/buyer-token.mjs <buyerId>");
    process.exit(1);
  }
  process.stdout.write(buyerToken(id));
}
