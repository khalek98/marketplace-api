import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { startServer, stopServer } from "../src/bootstrap.js";

let server;
let baseUrl;

before(async () => {
  server = await startServer({ app, port: 0, host: "127.0.0.1" });
  const { address, port } = server.address();
  baseUrl = `http://${address}:${port}`;
});

after(async () => {
  await stopServer(server);
});

function assertProblemJson(res) {
  assert.match(
    res.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );
}

async function postOrder({ key, body }) {
  const headers = { "Content-Type": "application/json" };
  if (key !== undefined) {
    headers["Idempotency-Key"] = key;
  }
  return fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /orders", () => {
  test("returns 400 problem+json when Idempotency-Key is missing", async () => {
    const res = await postOrder({
      body: { items: [{ product_id: "product_keyboard", quantity: 1 }] },
    });

    assert.equal(res.status, 400);
    assertProblemJson(res);
    const problem = await res.json();
    assert.match(problem.detail, /idempotency-key/i);
    assert.match(problem.detail, /required property/i);
  });

  test("returns 400 problem+json when items is empty", async () => {
    const res = await postOrder({
      key: `empty-items-${randomUUID()}`,
      body: { items: [] },
    });

    assert.equal(res.status, 400);
    assertProblemJson(res);
    const problem = await res.json();
    assert.match(problem.detail, /must NOT have fewer than 1 items/i);
  });

  test("returns 201 with Location on valid request", async () => {
    const res = await postOrder({
      key: `create-${randomUUID()}`,
      body: { items: [{ product_id: "product_keyboard", quantity: 1 }] },
    });

    assert.equal(res.status, 201);
    const location = res.headers.get("location");
    assert.ok(location?.startsWith("/orders/"));
    assert.equal(res.headers.get("idempotency-replay"), null);

    const order = await res.json();
    assert.equal(order.status, "placed");
    assert.ok(Array.isArray(order.items) && order.items.length === 1);
  });

  test("returns 201 with Idempotency-Replay on replay", async () => {
    const key = `replay-${randomUUID()}`;
    const body = { items: [{ product_id: "product_mouse", quantity: 1 }] };

    const first = await postOrder({ key, body });
    assert.equal(first.status, 201);
    const firstOrder = await first.json();

    const replay = await postOrder({ key, body });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get("idempotency-replay"), "true");
    assert.equal(replay.headers.get("location"), first.headers.get("location"));

    const replayOrder = await replay.json();
    assert.deepEqual(replayOrder, firstOrder);
  });

  test("returns 422 problem+json when same key has different body", async () => {
    const key = `conflict-${randomUUID()}`;

    const first = await postOrder({
      key,
      body: { items: [{ product_id: "product_stand", quantity: 1 }] },
    });
    assert.equal(first.status, 201);

    const conflict = await postOrder({
      key,
      body: { items: [{ product_id: "product_webcam", quantity: 1 }] },
    });

    assert.equal(conflict.status, 422);
    assertProblemJson(conflict);
  });
});

describe("GET /products", () => {
  test("returns 200 with items and next_cursor when limit=2", async () => {
    const res = await fetch(`${baseUrl}/products?limit=2`);

    assert.equal(res.status, 200);
    const page = await res.json();
    assert.equal(page.items.length, 2);
    assert.ok(page.next_cursor);
  });

  test("returns next page when cursor is provided", async () => {
    const first = await fetch(`${baseUrl}/products?limit=2`);
    assert.equal(first.status, 200);
    const firstPage = await first.json();

    const second = await fetch(
      `${baseUrl}/products?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
    );
    assert.equal(second.status, 200);
    const secondPage = await second.json();

    assert.equal(secondPage.items.length, 2);
    assert.notEqual(secondPage.items[0].id, firstPage.items[0].id);
  });

  test("returns 400 problem+json for invalid cursor", async () => {
    const res = await fetch(`${baseUrl}/products?cursor=invalid`);

    assert.equal(res.status, 400);
    assertProblemJson(res);
  });

  test("returns 404 problem+json when product is not found", async () => {
    const res = await fetch(`${baseUrl}/products/product_does_not_exist`);

    assert.equal(res.status, 404);
    assertProblemJson(res);
  });
});

describe("PATCH /products/{productId}", () => {
  test("returns 200 with updated fields", async () => {
    const name = `Updated Webcam ${randomUUID()}`;
    const res = await fetch(`${baseUrl}/products/product_webcam`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    assert.equal(res.status, 200);
    const product = await res.json();
    assert.equal(product.id, "product_webcam");
    assert.equal(product.name, name);
    assert.ok(typeof product.updated_at === "string");
  });

  test("returns 409 problem+json when an archived product catalog field is patched", async () => {
    const res = await fetch(`${baseUrl}/products/product_archived`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Should not apply" }),
    });

    assert.equal(res.status, 409);
    assertProblemJson(res);
    const problem = await res.json();
    assert.match(problem.type, /product-archived/);
  });

  test("returns 422 problem+json when an active product is left with zero stock", async () => {
    const res = await fetch(`${baseUrl}/products/product_lamp`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock_qty: 0 }),
    });

    assert.equal(res.status, 422);
    assertProblemJson(res);
    const problem = await res.json();
    assert.match(problem.type, /product-active-without-stock/);
  });

  test("returns 404 problem+json when product is not found", async () => {
    const res = await fetch(`${baseUrl}/products/product_does_not_exist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Missing product" }),
    });

    assert.equal(res.status, 404);
    assertProblemJson(res);
  });
});

describe("GET /orders/{orderId}", () => {
  test("returns 200 with the created order", async () => {
    const created = await postOrder({
      key: `get-order-${randomUUID()}`,
      body: { items: [{ product_id: "product_keyboard", quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const order = await created.json();

    const res = await fetch(`${baseUrl}/orders/${order.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), order);
  });

  test("returns 404 problem+json when order is not found", async () => {
    const res = await fetch(`${baseUrl}/orders/order_does_not_exist`);

    assert.equal(res.status, 404);
    assertProblemJson(res);
  });
});

describe("unknown routes", () => {
  test("returns 404 problem+json", async () => {
    const res = await fetch(`${baseUrl}/unknown-route`);

    assert.equal(res.status, 404);
    assertProblemJson(res);
  });
});
