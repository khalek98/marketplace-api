import { randomInt, randomUUID } from "node:crypto";

import type Redis from "ioredis";
import type { DataSource } from "typeorm";

import { loadProductCard, type ProductCard } from "./product-card";

/** Base TTL seconds; jitter spreads expiries so keys do not stampede together. */
export const PRODUCT_CACHE_TTL_BASE_SEC = 300;
/** Inclusive upper bound for extra seconds (spread ≥ 10s per HW). */
export const PRODUCT_CACHE_TTL_JITTER_SEC = 60;

/** Lock TTL — long enough for one heavy projection, short enough to recover. */
export const PRODUCT_CACHE_LOCK_PX = 5000;

/**
 * Compare-and-delete: release only our lock token.
 * Bare DEL can drop another process's lock after ours expired.
 */
export const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export function productCacheKey(productId: string | number): string {
  return `product:${productId}`;
}

export function productLockKey(productId: string | number): string {
  return `lock:product:${productId}`;
}

/** TTL = base + random(0..jitter) — always set; invalidation is extra, not instead. */
export function productCacheTtlSec(
  baseSec = PRODUCT_CACHE_TTL_BASE_SEC,
  jitterSec = PRODUCT_CACHE_TTL_JITTER_SEC,
): number {
  return baseSec + randomInt(0, jitterSec + 1);
}

export type CacheRole = "hit" | "leader" | "waiter" | "fallback";

export type CachedProductRead = {
  value: ProductCard;
  hit: boolean;
  role: CacheRole;
  ttlSec?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cache-aside with single-flight: on miss only one caller loads Postgres;
 * waiters poll the cache. Lock is an optimization — if it breaks, two SELECTs.
 */
export async function getProductCardCached(
  redis: Redis,
  ds: DataSource,
  productId: string | number,
): Promise<CachedProductRead> {
  const key = productCacheKey(productId);
  const cached = await redis.get(key);
  if (cached !== null) {
    return { value: JSON.parse(cached) as ProductCard, hit: true, role: "hit" };
  }

  const lockKey = productLockKey(productId);
  const token = randomUUID();
  const got = await redis.set(lockKey, token, "PX", PRODUCT_CACHE_LOCK_PX, "NX");

  if (got === "OK") {
    try {
      const value = await loadProductCard(ds, productId);
      const ttlSec = productCacheTtlSec();
      await redis.set(key, JSON.stringify(value), "EX", ttlSec);
      return { value, hit: false, role: "leader", ttlSec };
    } finally {
      await redis.eval(UNLOCK_LUA, 1, lockKey, token);
    }
  }

  for (let i = 0; i < 50; i++) {
    await sleep(20);
    const again = await redis.get(key);
    if (again !== null) {
      return { value: JSON.parse(again) as ProductCard, hit: true, role: "waiter" };
    }
  }

  // Leader did not fill in time — degrade to a direct load rather than fail the request.
  const value = await loadProductCard(ds, productId);
  const ttlSec = productCacheTtlSec();
  await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  return { value, hit: false, role: "fallback", ttlSec };
}

/** Explicit invalidation on write paths — in addition to TTL, never instead of it. */
export async function invalidateProductCard(redis: Redis, productId: string | number): Promise<number> {
  return redis.del(productCacheKey(productId));
}

/** Warm many cards; returns how many keys were written and the set of TTLs used. */
export async function warmProductCards(
  redis: Redis,
  ds: DataSource,
  productIds: Array<string | number>,
): Promise<{ warmed: number; ttlDistinct: number; ttls: number[] }> {
  const ttls: number[] = [];
  for (const id of productIds) {
    const value = await loadProductCard(ds, id);
    const ttlSec = productCacheTtlSec();
    ttls.push(ttlSec);
    await redis.set(productCacheKey(id), JSON.stringify(value), "EX", ttlSec);
  }
  return { warmed: productIds.length, ttlDistinct: new Set(ttls).size, ttls };
}
