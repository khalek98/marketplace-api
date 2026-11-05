import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  n: number,
  rounds: number,
  parallel: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, { N: n, r: rounds, p: parallel }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

const N = 16_384;
const r = 8;
const p = 1;
const KEY_LEN = 32;

/** Fixture / backfill marker. Not a scrypt string, so login will reject it. */
export const UNUSABLE_PASSWORD_HASH = "unset";

/** Local seed only. Not a vault secret. */
export const SEED_PASSWORD = "seed-password";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN, N, r, p);
  return encode(N, r, p, salt, hash);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = decode(stored);
  if (!parsed) return false;
  const actual = await scryptAsync(password, parsed.salt, parsed.hash.length, parsed.n, parsed.r, parsed.p);
  if (actual.length !== parsed.hash.length) return false;
  return timingSafeEqual(actual, parsed.hash);
}

function encode(n: number, rounds: number, parallel: number, salt: Buffer, hash: Buffer): string {
  return ["scrypt", n, rounds, parallel, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

function decode(stored: string): { n: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const [kind, nRaw, rRaw, pRaw, saltRaw, hashRaw] = stored.split("$");
  if (kind !== "scrypt" || !nRaw || !rRaw || !pRaw || !saltRaw || !hashRaw) return null;
  const n = Number(nRaw);
  const rounds = Number(rRaw);
  const parallel = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(rounds) || !Number.isInteger(parallel)) return null;
  return {
    n,
    r: rounds,
    p: parallel,
    salt: Buffer.from(saltRaw, "base64url"),
    hash: Buffer.from(hashRaw, "base64url"),
  };
}
