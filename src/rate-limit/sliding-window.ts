import { randomUUID } from "node:crypto";

import type Redis from "ioredis";

/**
 * Sliding window on a ZSET — all four steps must be atomic (one Lua script).
 * KEYS[1] window key; ARGV: nowMs, windowMs, limit, member.
 */
export const SLIDING_WINDOW_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])
local n = redis.call('ZCARD', KEYS[1])
if n < tonumber(ARGV[3]) then
  redis.call('ZADD',    KEYS[1], ARGV[1], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return {1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local score = tonumber(oldest[2])
local retryMs = tonumber(ARGV[2])
if score then
  retryMs = score + tonumber(ARGV[2]) - tonumber(ARGV[1])
end
if retryMs < 1 then retryMs = 1 end
return {0, retryMs}
`;

export type RateLimitDecision = {
  allowed: boolean;
  status: 200 | 429;
  /** Seconds for Retry-After when blocked (demo reports retry-after=1 when set). */
  retryAfterSec: number | null;
};

/**
 * Shared sliding-window limiter (Redis, not process memory).
 * Why this model: no boundary burst of up to 2× limit like a fixed window.
 */
export class SlidingWindowRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly opts: { limit: number; windowMs: number; keyPrefix?: string },
  ) {}

  async check(who: string): Promise<RateLimitDecision> {
    const key = `${this.opts.keyPrefix ?? "rl:slide"}:${who}`;
    const pair = (await this.redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(Date.now()),
      String(this.opts.windowMs),
      String(this.opts.limit),
      randomUUID(),
    )) as [number | string, number | string];

    if (Number(pair[0]) === 1) {
      return { allowed: true, status: 200, retryAfterSec: null };
    }
    const retryAfterSec = Math.max(1, Math.ceil(Number(pair[1]) / 1000));
    return { allowed: false, status: 429, retryAfterSec };
  }
}
