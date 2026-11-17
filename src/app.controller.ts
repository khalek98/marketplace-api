import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

import { DatabaseService } from "./database/database.service";
import { ReadinessService } from "./readiness.service";

@Controller()
export class AppController {
  constructor(
    private readonly database: DatabaseService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get("health")
  health() {
    return { status: "ok", uptimeSec: Math.round(process.uptime()) };
  }

  /** Liveness: process is up. Stays 200 during drain. */
  @Get("healthz")
  healthz() {
    return { alive: true, pid: process.pid };
  }

  /** Readiness: may receive traffic. 503 during warmup (pre-markReady) and drain. */
  @Get("readyz")
  readyz() {
    if (!this.readiness.isReady()) {
      throw new ServiceUnavailableException({ ready: false });
    }
    return { ready: true };
  }

  /** Proves DB connectivity; used after "rotate.sh". Password comes from the secret file. */
  @Get("db")
  async db() {
    try {
      const result = await this.database.query<{ current_user: string; now: string }>(
        "SELECT current_user, now()::text AS now",
      );
      return {
        status: "ok",
        ...result.rows[0],
        uptimeSec: Math.round(process.uptime()),
      };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: "error",
        message: err instanceof Error ? err.message : "Database query failed",
      });
    }
  }
}
