import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DataSource } from "typeorm";

import { applyNestTestEnv } from "./integration/testkit/nest-env";
import { MarketplacePg, startMarketplacePg } from "./integration/testkit/pg";

let pg: MarketplacePg | undefined;

/**
 * Postgres for one HTTP suite file. Jest isolates modules, so each file boots its own.
 * Do not import create-app before this runs: data-source reads DB_* at load time.
 */
export async function bootHttpDatabase(): Promise<DataSource> {
  if (!pg) {
    pg = await startMarketplacePg("(http)");
    applyNestTestEnv();
  } else if (!pg.dataSource.isInitialized) {
    await pg.dataSource.initialize();
  }
  return pg.dataSource;
}

export async function stopHttpDatabase(): Promise<void> {
  if (!pg) return;
  const current = pg;
  pg = undefined;
  await current.stop();
}

export async function createHttpApp(): Promise<INestApplication> {
  await bootHttpDatabase();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { configureApp } = require("../src/create-app") as typeof import("../src/create-app");

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
  await app.init();
  return app;
}
