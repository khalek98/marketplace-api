/**
 * Smoke-check both Redis instances from env (A2).
 * Usage: SKIP_VAULT=1 REDIS_URL=… REDIS_QUEUE_URL=… node dist/redis-ping.js
 */
import { closeRedis, createCacheRedis, createJobsRedis, redisConfigGet } from "./redis/clients";

async function main(): Promise<void> {
  const cache = createCacheRedis();
  const jobs = createJobsRedis();
  try {
    const cachePong = await cache.ping();
    const jobsPong = await jobs.ping();
    const policy = await redisConfigGet(cache, "maxmemory-policy");
    const maxmemory = await redisConfigGet(cache, "maxmemory");
    const jobsPolicy = await redisConfigGet(jobs, "maxmemory-policy");

    console.log(`cache-ping=${cachePong === "PONG" ? 1 : 0}`);
    console.log(`jobs-ping=${jobsPong === "PONG" ? 1 : 0}`);
    console.log(`cache-lru=${policy === "allkeys-lru" ? 1 : 0}`);
    console.log(`cache-maxmemory=${Number(maxmemory) > 0 ? 1 : 0}`);
    console.log(`queue-noeviction=${jobsPolicy === "noeviction" ? 1 : 0}`);

    if (cachePong !== "PONG" || jobsPong !== "PONG") {
      process.exitCode = 1;
    }
  } finally {
    await closeRedis(cache, jobs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
