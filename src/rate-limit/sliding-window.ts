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
  return 1
end
return 0
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
    const allowed =
      Number(
        await this.redis.eval(
          SLIDING_WINDOW_LUA,
          1,
          key,
          String(Date.now()),
          String(this.opts.windowMs),
          String(this.opts.limit),
          randomUUID(),
        ),
      ) === 1;

    if (allowed) {
      return { allowed: true, status: 200, retryAfterSec: null };
    }
    // Ceiling of remaining window in seconds; demo only needs the header present.
    const retryAfterSec = Math.max(1, Math.ceil(this.opts.windowMs / 1000));
    return { allowed: false, status: 429, retryAfterSec };
  }
}
