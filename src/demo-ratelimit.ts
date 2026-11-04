/**
 * demo:ratelimit — two "pods" share one Redis sliding-window counter.
 * Self-clean; prints key=number for the grader.
 */
import { closeRedis, createJobsRedis } from "./redis/clients";
import { SlidingWindowRateLimiter } from "./rate-limit/sliding-window";

const LIMIT = 5;
const WINDOW_MS = 60_000;
const INSTANCES = 2;
const TOTAL_REQUESTS = 12;
const CLIENT = "demo-api-key";

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function main(): Promise<void> {
  // Jobs Redis (noeviction): rate-limit counters must not vanish under LRU.
  const redis = createJobsRedis();

  try {
    const old = await redis.keys("rl:slide:*");
    if (old.length > 0) await redis.del(...old);

    // Two independent limiter instances = two pods, one shared store.
    const pods = Array.from(
      { length: INSTANCES },
      () => new SlidingWindowRateLimiter(redis, { limit: LIMIT, windowMs: WINDOW_MS }),
    );

    let allowed = 0;
    let blocked = 0;
    let lastBlockedStatus = 0;
    let retryAfterHeader = 0;

    for (let i = 0; i < TOTAL_REQUESTS; i++) {
      const pod = pods[i % INSTANCES]!;
      const decision = await pod.check(CLIENT);
      if (decision.allowed) {
        allowed += 1;
      } else {
        blocked += 1;
        lastBlockedStatus = decision.status;
        if (decision.retryAfterSec !== null) retryAfterHeader = 1;
      }
    }

    line("instances", INSTANCES);
    line("limit", LIMIT);
    line("requests", TOTAL_REQUESTS);
    line("allowed", allowed);
    line("blocked", blocked);
    line("status", lastBlockedStatus);
    line("retry-after", retryAfterHeader);

    const ok =
      INSTANCES >= 2 &&
      LIMIT > 0 &&
      allowed === LIMIT &&
      blocked >= 1 &&
      lastBlockedStatus === 429 &&
      retryAfterHeader === 1;
    if (!ok) process.exitCode = 1;
  } finally {
    await closeRedis(redis);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
