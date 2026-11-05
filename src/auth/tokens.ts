import { createHmac, randomBytes, randomUUID } from "node:crypto";

import type { SigningMaterial } from "../config/signing-keys";

function loadJose() {
  // Static `import` of jose is rejected: this project emits CommonJS.
  // Node 22 runs the dynamic import, and the module loader caches it.
  return import("jose");
}

export const ISSUER = "marketplace-api";
export const AUDIENCE = "marketplace";

/** Access lives long enough for a demo, short enough that logout still matters. */
export const ACCESS_TTL_SEC = 15 * 60;
/** Idle refresh lifetime. Rotation copies the absolute deadline, not this one. */
export const REFRESH_IDLE_SEC = 14 * 24 * 60 * 60;
export const REFRESH_ABSOLUTE_SEC = 30 * 24 * 60 * 60;
/** Parallel retries of the same refresh get the pair already issued. Past this, reuse kills the family. */
export const REFRESH_GRACE_MS = 3_000;

export type AccessToken = {
  token: string;
  jti: string;
  expiresIn: number;
};

export async function issueAccessToken(
  keys: SigningMaterial,
  user: { id: string; role: string },
): Promise<AccessToken> {
  const jti = randomUUID();
  const { SignJWT } = await loadJose();
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "ES256", kid: keys.kid })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(keys.privateKey);

  return { token, jti, expiresIn: ACCESS_TTL_SEC };
}

/**
 * Allowlist is the check. The token's own `alg` header is not.
 * RFC 8725 §3.1: the verifier chooses the algorithm.
 */
export async function verifyAccessToken(
  keys: SigningMaterial,
  token: string,
): Promise<{ sub: string; role: string; jti: string; exp: number }> {
  const { jwtVerify } = await loadJose();
  const { payload, protectedHeader } = await jwtVerify(token, keys.publicKey, {
    algorithms: ["ES256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (protectedHeader.kid !== keys.kid) {
    throw new Error("access token kid does not match the active key");
  }
  if (typeof payload.sub !== "string" || typeof payload.jti !== "string" || typeof payload.exp !== "number") {
    throw new Error("access token is missing sub, jti, or exp");
  }
  const role = payload.role;
  if (typeof role !== "string") {
    throw new Error("access token is missing role");
  }
  return { sub: payload.sub, role, jti: payload.jti, exp: payload.exp };
}

/** 32 random bytes. This string is what the client keeps. The database stores the HMAC. */
export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(pepper: string, token: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

export function newFamilyId(): string {
  return randomUUID();
}
