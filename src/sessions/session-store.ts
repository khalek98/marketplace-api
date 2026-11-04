import { randomUUID } from "node:crypto";

import type Redis from "ioredis";

/** Default idle window; each touch resets it (rolling TTL). */
export const SESSION_TTL_SEC = 30;

export type SessionData = {
  sid: string;
  userId: string;
  createdAt: string;
};

export function sessionKey(sid: string): string {
  return `sess:${sid}`;
}

/**
 * Session / token-state on the jobs Redis (noeviction), not the cache instance.
 * Rolling TTL via GETEX — read and renew in one round-trip.
 */
export async function createSession(redis: Redis, userId: string, ttlSec = SESSION_TTL_SEC): Promise<SessionData> {
  const sid = randomUUID();
  const data: SessionData = {
    sid,
    userId,
    createdAt: new Date().toISOString(),
  };
  await redis.set(sessionKey(sid), JSON.stringify(data), "EX", ttlSec);
  return data;
}

/** Touch session: return payload and refresh TTL, or null if missing/expired. */
export async function touchSession(redis: Redis, sid: string, ttlSec = SESSION_TTL_SEC): Promise<SessionData | null> {
  const raw = await redis.getex(sessionKey(sid), "EX", ttlSec);
  if (raw === null) return null;
  return JSON.parse(raw) as SessionData;
}

export async function sessionExists(redis: Redis, sid: string): Promise<boolean> {
  return (await redis.exists(sessionKey(sid))) === 1;
}

export async function sessionTtl(redis: Redis, sid: string): Promise<number> {
  return redis.ttl(sessionKey(sid));
}
