import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";

import { createJobsRedis } from "../redis/clients";
import { REFRESH_GRACE_MS } from "./tokens";

export type GracePair = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
};

/** Successor pair for one refresh hash, visible to every replica for the grace window. */
@Injectable()
export class RefreshGrace implements OnModuleDestroy {
  private redis: Redis | undefined;

  async put(hash: string, pair: GracePair): Promise<void> {
    await this.client().set(key(hash), JSON.stringify(pair), "PX", REFRESH_GRACE_MS);
  }

  async get(hash: string): Promise<GracePair | undefined> {
    const raw = await this.client().get(key(hash));
    if (!raw) return undefined;
    return JSON.parse(raw) as GracePair;
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

function key(hash: string): string {
  return `refresh-grace:${hash}`;
}
