import { randomUUID } from "node:crypto";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { DataSource } from "typeorm";

import { Product } from "../../src/entities/product.entity";
import { Wallet } from "../../src/entities/wallet.entity";
import { assertProblemJson, postOrder } from "../helpers";
import { aProduct, aUser, aWallet } from "../integration/testkit/builders";
import { applyNestTestEnv } from "../integration/testkit/nest-env";
import { MarketplacePg, startMarketplacePg, truncateData } from "../integration/testkit/pg";

/**
 * Full Nest app (AppModule, OpenAPI validator, ProblemJsonFilter) on a
 * testcontainers Postgres. No provider overrides — same path as main.ts.
 *
 * Do not statically import create-app / AppModule here: they pull OrdersService
 * → data-source before DB_* is set. require() only after startMarketplacePg.
 */
describe("e2e · orders", () => {
  let pg: MarketplacePg;
  let ds: DataSource;
  let app: INestApplication;
  let cleanupAuth: () => void;

  beforeAll(async () => {
    pg = await startMarketplacePg("(e2e)");
    ds = pg.dataSource;
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
  }, 120_000);

  beforeEach(async () => {
    await truncateData(ds);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await pg.stop();
    cleanupAuth?.();
  });

  test("happy path: POST /orders → 201 Location, GET → 200 same body; stock and wallet drop", async () => {
    const seller = await aUser().withRole("seller").insert(ds);
    const buyer = await aUser().withRole("buyer").insert(ds);
    await aWallet().forUser(buyer.id).withBalance(50_000).insert(ds);
    const product = await aProduct()
      .forSeller(seller.id)
      .withName("E2E Keyboard")
      .withPrice(2_500)
      .withStock(5)
      .insert(ds);

    const created = await postOrder(app, {
      key: `e2e-create-${randomUUID()}`,
      body: {
        buyer_id: buyer.id,
        items: [{ product_id: product.id, quantity: 2 }],
      },
    });

    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(`/orders/${created.body.id}`);
    expect(created.body).toMatchObject({
      status: "placed",
      total_cents: 5_000,
      items: [
        expect.objectContaining({
          product_id: product.id,
          quantity: 2,
          unit_price_cents: 2_500,
          line_total_cents: 5_000,
        }),
      ],
    });

    const fetched = await request(app.getHttpServer()).get(created.headers.location).expect(200);
    expect(fetched.body).toEqual(created.body);

    const stock = await ds.getRepository(Product).findOneByOrFail({ id: product.id });
    const wallet = await ds.getRepository(Wallet).findOneByOrFail({ userId: buyer.id });
    expect(stock.stockQty).toBe(3);
    expect(wallet.balanceCents).toBe(45_000);
  });

  test("GET /orders/999999999 → 404 problem+json", async () => {
    const res = await request(app.getHttpServer()).get("/orders/999999999");

    expect(res.status).toBe(404);
    assertProblemJson(res);
    expect(res.body.title).toMatch(/not found/i);
  });
});
