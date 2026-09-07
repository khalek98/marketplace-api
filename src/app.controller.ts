import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

import { DatabaseService } from "./database/database.service";

@Controller()
export class AppController {
  constructor(private readonly database: DatabaseService) {}

  @Get("health")
  health() {
    return { status: "ok", uptimeSec: Math.round(process.uptime()) };
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
