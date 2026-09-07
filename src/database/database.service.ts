import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, QueryResult, QueryResultRow } from "pg";

import { Env } from "../config/env.schema";

/**
 * pg.Pool with password loaded from a file on every new connection.
 * Env passwords freeze at process start; a file can be rotated without restart.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    const dbUrl = new URL(config.get("DB_URL", { infer: true }));
    const secretFile = resolve(process.cwd(), config.get("DB_PASSWORD_FILE", { infer: true }));

    this.pool = new Pool({
      host: dbUrl.hostname,
      port: Number(dbUrl.port || 5432),
      database: dbUrl.pathname.replace(/^\//, ""),
      user: decodeURIComponent(dbUrl.username),
      // Heart of AC5: driver calls this for each new connection after terminate.
      password: async () => (await readFile(secretFile, "utf8")).trim(),
      max: 3,
    });

    // Required: pg_terminate_backend emits 'error' on idle clients; without a
    // listener Node crashes with Unhandled 'error' event.
    this.pool.on("error", (err) => {
      this.logger.warn(
        `Idle client error (${(err as NodeJS.ErrnoException).code ?? "unknown"}) — pool will open a new connection`,
      );
    });
  }

  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
