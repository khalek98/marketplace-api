import { randomInt } from "node:crypto";

import type Redis from "ioredis";
import type { DataSource } from "typeorm";

import { loadProductCard, type ProductCard } from "./product-card";

/** Base TTL seconds; jitter spreads expiries so keys do not stampede together. */
export const PRODUCT_CACHE_TTL_BASE_SEC = 300;
/** Inclusive upper bound for extra seconds (spread ≥ 10s per HW). */
export const PRODUCT_CACHE_TTL_JITTER_SEC = 60;

export function productCacheKey(productId: string | number): string {
  return `product:${productId}`;
}

/** TTL = base + random(0..jitter) — always set; invalidation is extra, not instead. */
export function productCacheTtlSec(
  baseSec = PRODUCT_CACHE_TTL_BASE_SEC,
  jitterSec = PRODUCT_CACHE_TTL_JITTER_SEC,
): number {
  return baseSec + randomInt(0, jitterSec + 1);
}

export type CachedProductRead = {
  value: ProductCard;
  hit: boolean;
  ttlSec?: number;
};

/**
 * Cache-aside: GET → on miss load from Postgres → SET with jittered EX.
 * Does not take a stampede lock yet (that is A5).
 */
export async function getProductCardCached(
  redis: Redis,
  ds: DataSource,
  productId: string | number,
): Promise<CachedProductRead> {
  const key = productCacheKey(productId);
  const cached = await redis.get(key);
  if (cached !== null) {
    return { value: JSON.parse(cached) as ProductCard, hit: true };
  }

  const value = await loadProductCard(ds, productId);
  const ttlSec = productCacheTtlSec();
  await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  return { value, hit: false, ttlSec };
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
