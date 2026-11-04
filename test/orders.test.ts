import { randomUUID } from "node:crypto";

import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { aProduct, aUser, aWallet } from "./integration/testkit/builders";
import { assertProblemJson, postOrder } from "./helpers";
import { bootHttpDatabase, createHttpApp, stopHttpDatabase } from "./http-app";

let app: INestApplication;
let buyerId: string;
let keyboardId: string;
let mouseId: string;
let standId: string;

beforeAll(async () => {
  const ds = await bootHttpDatabase();
  app = await createHttpApp();

  const seller = await aUser().withRole("seller").insert(ds);
  const buyer = await aUser().withRole("buyer").insert(ds);
  await aWallet().forUser(buyer.id).withBalance(500_000).insert(ds);
  buyerId = buyer.id;
  keyboardId = (await aProduct().forSeller(seller.id).withStock(20).insert(ds)).id;
  mouseId = (await aProduct().forSeller(seller.id).withStock(20).insert(ds)).id;
  standId = (await aProduct().forSeller(seller.id).withStock(20).insert(ds)).id;
});

afterAll(async () => {
  if (app) await app.close();
  await stopHttpDatabase();
});

describe("POST /orders", () => {
  it("returns 400 problem+json when Idempotency-Key is missing", async () => {
    const res = await postOrder(app, {
      body: { buyer_id: buyerId, items: [{ product_id: keyboardId, quantity: 1 }] },
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/idempotency-key/i);
    expect(res.body.detail).toMatch(/required property/i);
    assertProblemJson(res);
  });

  it("returns 400 problem+json when items is empty", async () => {
    const res = await postOrder(app, {
      key: `empty-items-${randomUUID()}`,
      body: { buyer_id: buyerId, items: [] },
    });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
    expect(res.body.detail).toMatch(/must NOT have fewer than 1 items/i);
  });

  it("returns 201 with Location on valid request", async () => {
    const res = await postOrder(app, {
      key: `create-${randomUUID()}`,
      body: { buyer_id: buyerId, items: [{ product_id: keyboardId, quantity: 1 }] },
    });

    expect(res.status).toBe(201);
    const location = res.headers["location"];
    expect(location?.startsWith("/orders/")).toBe(true);

    const order = res.body;
    expect(order.status).toBe("placed");
    expect(Array.isArray(order.items) && order.items.length === 1).toBe(true);
  });

  it("returns 201 with Idempotency-Replay on replay", async () => {
    const key = `replay-${randomUUID()}`;
    const body = { buyer_id: buyerId, items: [{ product_id: mouseId, quantity: 1 }] };

    const first = await postOrder(app, { key, body });
    expect(first.status).toBe(201);
    const firstOrder = first.body;

    const replay = await postOrder(app, { key, body });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replay"]).toBe("true");
    expect(replay.headers["location"]).toBe(first.headers["location"]);
    const replayOrder = replay.body;
    expect(replayOrder).toEqual(firstOrder);
  });

  it("returns 422 problem+json when same key has different body", async () => {
    const key = `conflict-${randomUUID()}`;

    const first = await postOrder(app, {
      key,
      body: { buyer_id: buyerId, items: [{ product_id: standId, quantity: 1 }] },
    });
    expect(first.status).toBe(201);

    const conflict = await postOrder(app, {
      key,
      body: { buyer_id: buyerId, items: [{ product_id: keyboardId, quantity: 1 }] },
    });
    expect(conflict.status).toBe(422);
    assertProblemJson(conflict);
  });
});

describe("GET /orders/{orderId}", () => {
  it("returns 200 with the created order", async () => {
    const created = await postOrder(app, {
      key: `get-order-${randomUUID()}`,
      body: { buyer_id: buyerId, items: [{ product_id: keyboardId, quantity: 1 }] },
    });
    expect(created.status).toBe(201);
    const order = created.body;

    const res = await request(app.getHttpServer()).get(`/orders/${order.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(order);
  });

  it("returns 404 problem+json when order is not found", async () => {
    const res = await request(app.getHttpServer()).get("/orders/999999999");

    expect(res.status).toBe(404);
    assertProblemJson(res);
  });
});
