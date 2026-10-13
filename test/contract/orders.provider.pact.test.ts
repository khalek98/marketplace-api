import fs from "node:fs";
import path from "node:path";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Verifier } from "@pact-foundation/pact";
import type { DataSource } from "typeorm";

import { applyNestTestEnv } from "../integration/testkit/nest-env";
import { MarketplacePg, startMarketplacePg } from "../integration/testkit/pg";

const PROVIDER_PORT = Number(process.env.PACT_PROVIDER_PORT || 21121);
const PACT_FILE = path.resolve(process.cwd(), "pacts", "marketplace-web-marketplace-api.json");

async function seedOrder7(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO users (id, email, role)
     VALUES (1, 'pact-buyer@example.com', 'buyer')
     ON CONFLICT (id) DO NOTHING`,
  );
  await ds.query(
    `INSERT INTO users (id, email, role)
     VALUES (2, 'pact-seller@example.com', 'seller')
     ON CONFLICT (id) DO NOTHING`,
  );
  await ds.query(
    `INSERT INTO products (id, seller_id, name, description, price_cents, stock_qty, status)
     VALUES (1, 2, 'Pact Product', 'Seed for pact provider state', 2500, 10, 'active')
     ON CONFLICT (id) DO NOTHING`,
  );
  await ds.query(
    `INSERT INTO orders (id, buyer_id, status, currency, total_amount_cents)
     VALUES (7, 1, 'placed', 'UAH', 2500)
     ON CONFLICT (id) DO NOTHING`,
  );
  await ds.query(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents)
     SELECT 7, 1, 'Pact Product', 1, 2500, 2500
     WHERE NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = 7)`,
  );
}

/**
 * Real marketplace-api (Nest + testcontainers Postgres) must satisfy the pact.
 * Uses Jest/ts-jest so Nest DI keeps emitDecoratorMetadata (tsx/esbuild would not).
 */
describe("contract · provider verification: marketplace-api", () => {
  let pg: MarketplacePg;
  let app: INestApplication;
  let cleanupAuth: () => void;

  beforeAll(async () => {
    expect(fs.existsSync(PACT_FILE)).toBe(true);

    pg = await startMarketplacePg("(pact-provider)");
    ({ cleanup: cleanupAuth } = applyNestTestEnv());

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require("../../src/app.module") as typeof import("../../src/app.module");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { configureApp } = require("../../src/create-app") as typeof import("../../src/create-app");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    await app.listen(PROVIDER_PORT);
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await pg.stop();
    cleanupAuth?.();
  });

  test("all interactions in marketplace-web-marketplace-api.json pass", async () => {
    const brokerUrl = process.env.PACT_BROKER_URL?.trim();
    const providerVersion = process.env.PROVIDER_VERSION ?? "1.0.0";
    const output = await new Verifier({
      provider: "marketplace-api",
      providerBaseUrl: `http://127.0.0.1:${PROVIDER_PORT}`,
      providerVersion,
      ...(brokerUrl
        ? {
            pactBrokerUrl: brokerUrl,
            pactBrokerToken: process.env.PACT_BROKER_TOKEN,
            ...(process.env.PACT_BROKER_TOKEN ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN } : {}),
            publishVerificationResult: true,
            providerVersion: process.env.PROVIDER_VERSION ?? "1.0.0",
            providerVersionBranch: process.env.PROVIDER_VERSION_BRANCH ?? "hw-16",
            consumerVersionSelectors: [{ latest: true }],
          }
        : {
            pactUrls: [PACT_FILE],
            publishVerificationResult: false,
          }),
      stateHandlers: {
        "order 7 exists": async () => {
          await seedOrder7(pg.dataSource);
        },
      },
      logLevel: "warn",
    }).verifyProvider();

    console.log("verifier:", output);
    expect(output).toEqual(expect.stringMatching(/has a matching body \(OK\)|"result"\s*:\s*"OK"/));
  });
});
