import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import type { Env } from "./env.schema";

export type SigningMaterial = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Short sha256 of the public key. Safe to log; the key itself is not. */
  fingerprint: string;
  pepper: string;
};

/**
 * Turn vault base64 PEM into KeyObjects before the process touches the database.
 * A bad value throws with the env name in the message.
 */
export function loadSigningKeys(
  env: Pick<Env, "JWT_KID" | "JWT_PRIVATE_KEY" | "JWT_PUBLIC_KEY" | "REFRESH_TOKEN_PEPPER">,
): SigningMaterial {
  const privateKey = keyFromBase64(env.JWT_PRIVATE_KEY, "JWT_PRIVATE_KEY", "private");
  const publicKey = keyFromBase64(env.JWT_PUBLIC_KEY, "JWT_PUBLIC_KEY", "public");
  assertEs256Pair(privateKey, publicKey);

  const fingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 8);

  return {
    kid: env.JWT_KID,
    privateKey,
    publicKey,
    fingerprint,
    pepper: env.REFRESH_TOKEN_PEPPER,
  };
}

function keyFromBase64(b64: string, name: string, kind: "private" | "public"): KeyObject {
  const pem = Buffer.from(b64, "base64").toString("utf8");
  try {
    return kind === "private" ? createPrivateKey(pem) : createPublicKey(pem);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${name}: expected base64 of a PEM (${message})`);
  }
}

function assertEs256Pair(privateKey: KeyObject, publicKey: KeyObject): void {
  const curve = privateKey.asymmetricKeyDetails?.namedCurve;
  if (privateKey.asymmetricKeyType !== "ec" || curve !== "prime256v1") {
    throw new Error("JWT_PRIVATE_KEY: expected an EC P-256 private key (ES256)");
  }
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("JWT_PUBLIC_KEY: expected an EC P-256 public key (ES256)");
  }

  const payload = Buffer.from("marketplace-signing-key");
  const signature = sign("sha256", payload, privateKey);
  const matches = verify("sha256", payload, publicKey, signature);
  if (!matches) {
    throw new Error("JWT_PUBLIC_KEY does not match JWT_PRIVATE_KEY");
  }
}
