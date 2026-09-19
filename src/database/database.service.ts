import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, QueryResult, QueryResultRow } from "pg";

import { Env } from "../config/env.schema";

/**
 * pg.Pool with user+password loaded from a file on every new connection.
 * Env passwords freeze at process start; a file can be rotated without restart.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    const dbUrl = new URL(config.get("DB_URL", { infer: true }));
    const authFile = resolve(process.cwd(), config.get("DB_AUTH_FILE", { infer: true }));

    const readAuth = async () => {
      const [user, password] = (await readFile(authFile, "utf8")).trim().split("\n");
      if (!user || !password) throw new Error(`Bad auth file: ${authFile}`);
      return { user: user.trim(), password: password.trim() };
    };

    this.pool = new Pool({
      host: dbUrl.hostname,
      port: Number(dbUrl.port || 5432),
      database: dbUrl.pathname.replace(/^\//, ""),
      max: 3,
    });

    const originalConnect = this.pool.connect.bind(this.pool);
    this.pool.connect = ((cb?: any) => {
      const run = async () => {
        const auth = await readAuth();
        (this.pool as Pool).options.user = auth.user;
        (this.pool as Pool).options.password = auth.password;
        return originalConnect();
      };
      if (cb) {
        run().then(
          (c) => cb(null, c),
          (e) => cb(e),
        );
        return;
      }
      return run();
    }) as typeof this.pool.connect;

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
