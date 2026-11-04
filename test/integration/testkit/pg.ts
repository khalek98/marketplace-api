import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { DataSource } from "typeorm";

export interface MarketplacePg {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
  startupMs: number;
  stop(): Promise<void>;
}

const DATA_TABLES = ["order_items", "orders", "jobs", "products", "wallets", "users"] as const;

/**
 * Start a real postgres:16-alpine, point process.env at it, then load the
 * TypeORM DataSource singleton (options are read at import time).
 */
export async function startMarketplacePg(label = ""): Promise<MarketplacePg> {
  // Drop compose leftovers so the singleton does not dial PgBouncer 21111.
  delete process.env.DB_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;
  delete process.env.DB_USER;
  delete process.env.DB_PASSWORD;
  delete process.env.DB_NAME;

  const t0 = Date.now();
  const container = await new PostgreSqlContainer("postgres:16-alpine").withDatabase("shop").start();
  const startupMs = Date.now() - t0;

  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getMappedPort(5432));
  process.env.DB_USER = container.getUsername();
  process.env.DB_PASSWORD = container.getPassword();
  process.env.DB_NAME = container.getDatabase();

  // Load only after env is set — data-source.ts builds options at require time.
  // Jest CJS cannot use await import() without --experimental-vm-modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dataSource = require("../../../src/data-source").default as DataSource;
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
    await dataSource.runMigrations();
  }

  // eslint-disable-next-line no-console
  console.log(
    `[testkit] postgres:16-alpine${label ? ` ${label}` : ""} ready in ${startupMs} ms → ${container.getConnectionUri()}`,
  );

  return {
    container,
    dataSource,
    startupMs,
    async stop() {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
      await container.stop();
    },
  };
}

/** Clear domain rows between tests. Leaves `migrations` / typeorm_metadata alone. */
export async function truncateData(dataSource: DataSource): Promise<void> {
  await dataSource.query(`TRUNCATE ${DATA_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as { code?: string; driverError?: { code?: string } };
  return anyErr.code ?? anyErr.driverError?.code;
}
