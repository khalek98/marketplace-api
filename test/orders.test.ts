import { randomUUID } from "node:crypto";
import http from "node:http";

import { INestApplication } from "@nestjs/common";
import { io } from "socket.io-client";
import request from "supertest";

import { signBuyerToken } from "../src/orders/buyer-token";
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

describe("GET /orders/{orderId}/events", () => {
  it("returns 401 without a buyer token and 403 for another buyer", async () => {
    const created = await postOrder(app, {
      key: `events-auth-${randomUUID()}`,
      body: { buyer_id: buyerId, items: [{ product_id: keyboardId, quantity: 1 }] },
    });
    expect(created.status).toBe(201);

    const open = await request(app.getHttpServer()).get(`/orders/${created.body.id}/events`);
    expect(open.status).toBe(401);
    assertProblemJson(open);

    const ds = await bootHttpDatabase();
    const other = await aUser().withRole("buyer").insert(ds);
    const foreign = await request(app.getHttpServer())
      .get(`/orders/${created.body.id}/events`)
      .set("Authorization", `Bearer ${signBuyerToken(other.id, process.env.CURSOR_HMAC_SECRET ?? "")}`);
    expect(foreign.status).toBe(403);
    assertProblemJson(foreign);
  });

  it("streams to the owner and refuses join that only claims a buyerId", async () => {
    const created = await postOrder(app, {
      key: `events-owner-${randomUUID()}`,
      body: { buyer_id: buyerId, items: [{ product_id: mouseId, quantity: 1 }] },
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id as string;
    const token = signBuyerToken(buyerId, process.env.CURSOR_HMAC_SECRET ?? "");

    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;

    const contentType = await new Promise<string | undefined>((resolve, reject) => {
      const req = http.get(
        {
          port,
          path: `/orders/${orderId}/events`,
          headers: { Authorization: `Bearer ${token}` },
        },
        (res) => {
          res.resume();
          req.destroy();
          resolve(res.headers["content-type"]);
        },
      );
      req.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
        reject(err);
      });
    });
    expect(contentType).toMatch(/text\/event-stream/);

    const owner = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token } });
    const claimed = io(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
    try {
      await Promise.all([waitFor(owner, "connect"), waitFor(claimed, "connect")]);
      expect(await emitJoin(owner, { orderId })).toEqual({ ok: true, room: `orders:${orderId}` });
      expect(await emitJoin(claimed, { orderId, buyerId })).toEqual({ ok: false });
    } finally {
      owner.close();
      claimed.close();
    }
  });
});

function waitFor(socket: ReturnType<typeof io>, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 3000);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function emitJoin(socket: ReturnType<typeof io>, payload: { orderId: string; buyerId?: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timeout")), 3000);
    socket.emit("join", payload, (ack: unknown) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}
