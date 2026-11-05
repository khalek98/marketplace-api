import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";

import { createJobsRedis } from "../redis/clients";
import { denyKey, ISSUER } from "./tokens";

/** Access-token denylist on the queue Redis (noeviction), not the LRU cache. */
@Injectable()
export class Denylist implements OnModuleDestroy {
  private redis: Redis | undefined;

  async revoke(jti: string, ttlSec: number): Promise<void> {
    if (ttlSec < 1) return;
    await this.client().set(denyKey(ISSUER, jti), "1", "EX", ttlSec);
  }

  async has(jti: string): Promise<boolean> {
    const found = await this.client().exists(denyKey(ISSUER, jti));
    return found === 1;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
    this.redis = undefined;
  }

  private client(): Redis {
    if (!this.redis) {
      const redis = createJobsRedis({ lazyConnect: true, maxRetriesPerRequest: 1 });
      redis.on("error", () => {
        // The failing command rejects. This listener only keeps the process alive.
      });
      this.redis = redis;
    }
    return this.redis;
  }
}
