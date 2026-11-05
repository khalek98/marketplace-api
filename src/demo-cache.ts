/**
 * demo:cache — cache-aside + TTL jitter + single-flight stampede lock.
 * Self-clean; prints key=number lines for the grader.
 */
import "reflect-metadata";

import { getProductCardCached, productCacheKey, warmProductCards } from "./catalog/product-cache";
import { countDbCalls, resetDbCalls } from "./catalog/product-card";
import dataSource from "./data-source";
import { closeRedis, createCacheRedis, redisConfigGet } from "./redis/clients";

const WARM_COUNT = 50;
const CONCURRENT = 25;
const WARM_READS = 100;

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const redis = createCacheRedis();

  try {
    const policy = await redisConfigGet(redis, "maxmemory-policy");
    const maxmemory = await redisConfigGet(redis, "maxmemory");
    const cacheLru = policy !== "noeviction" && policy.includes("lru") ? 1 : 0;
    const cacheMaxmemory = Number(maxmemory) > 0 ? 1 : 0;

    const ids = (
      await dataSource.query(`SELECT id::text AS id FROM products ORDER BY id ASC LIMIT $1`, [WARM_COUNT])
    ).map((r: { id: string }) => r.id);
    if (ids.length < WARM_COUNT) {
      throw new Error(`demo:cache needs ≥${WARM_COUNT} products — run npm run seed`);
    }

    // Self-clean: drop prior product keys in this namespace, reset DB hit journal.
    const oldKeys = await redis.keys("product:*");
    if (oldKeys.length > 0) await redis.del(...oldKeys);
    const oldLocks = await redis.keys("lock:product:*");
    if (oldLocks.length > 0) await redis.del(...oldLocks);
    await resetDbCalls(dataSource);

    const warm = await warmProductCards(redis, dataSource, ids);
    const victimId = ids[0] as string;

    // Fresh miss under load (controlled delete). Lock must still yield one DB trip.
    await redis.del(productCacheKey(victimId));
    await resetDbCalls(dataSource);

    await Promise.all(Array.from({ length: CONCURRENT }, () => getProductCardCached(redis, dataSource, victimId)));
    const dbCalls = await countDbCalls(dataSource, victimId);

    await resetDbCalls(dataSource);
    for (let i = 0; i < WARM_READS; i++) {
      await getProductCardCached(redis, dataSource, victimId);
    }
    const dbCallsWarm = await countDbCalls(dataSource, victimId);

    line("cache-lru", cacheLru);
    line("cache-maxmemory", cacheMaxmemory);
    line("warmed", warm.warmed);
    line("ttl-distinct", warm.ttlDistinct);
    line("concurrent", CONCURRENT);
    line("db-calls", dbCalls);
    line("db-calls-warm", dbCallsWarm);

    const ok =
      cacheLru === 1 &&
      cacheMaxmemory === 1 &&
      warm.warmed >= 50 &&
      warm.ttlDistinct >= 5 &&
      CONCURRENT >= 20 &&
      dbCalls === 1 &&
      dbCallsWarm === 0;
    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await closeRedis(redis);
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
