import Redis, { type RedisOptions } from "ioredis";

/** Cache Redis URL (`REDIS_URL` → compose :21140). */
export function redisUrlFromEnv(): string {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error("REDIS_URL is required (redis://… — cache instance on 21140)");
  }
  return url;
}

/** Queue / sessions Redis URL (`REDIS_QUEUE_URL` → compose :21141). */
export function redisQueueUrlFromEnv(): string {
  const url = process.env.REDIS_QUEUE_URL?.trim();
  if (!url) {
    throw new Error("REDIS_QUEUE_URL is required (redis://… — jobs instance on 21141)");
  }
  return url;
}

/**
 * BullMQ Worker connection options. Docs require maxRetriesPerRequest: null so
 * the worker waits through a Redis blip instead of throwing. Queue producers
 * may omit this (fail fast is fine).
 */
export function jobsConnectionFromEnv(url = redisQueueUrlFromEnv()): RedisOptions & { maxRetriesPerRequest: null } {
  return {
    ...parseRedisUrl(url),
    maxRetriesPerRequest: null,
  };
}

export function createCacheRedis(opts: RedisOptions = {}, url = redisUrlFromEnv()): Redis {
  return new Redis(url, { lazyConnect: false, ...opts });
}

export function createJobsRedis(opts: RedisOptions = {}, url = redisQueueUrlFromEnv()): Redis {
  return new Redis(url, { lazyConnect: false, ...opts });
}

export async function closeRedis(...clients: Array<Redis | undefined>): Promise<void> {
  await Promise.all(clients.map((c) => c?.quit().catch(() => undefined)));
}

/** One CONFIG GET value (ioredis returns a flat [name, value] array). */
export async function redisConfigGet(r: Redis, name: string): Promise<string> {
  const pairs = (await r.config("GET", name)) as unknown as string[];
  return pairs[1] ?? "";
}

function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined,
  };
}
