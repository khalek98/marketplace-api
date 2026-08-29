import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function assertProblemJson(res) {
  assert.match(
    res.headers.get('content-type') ?? '',
    /application\/problem\+json/,
  );
}

async function postOrder({ key, body }) {
  const headers = { 'Content-Type': 'application/json' };
  if (key !== undefined) {
    headers['Idempotency-Key'] = key;
  }
  return fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /orders', () => {
  test('returns 400 problem+json when Idempotency-Key is missing', async () => {
    const res = await postOrder({
      body: { items: [{ product_id: 'product_keyboard', quantity: 1 }] },
    });

    assert.equal(res.status, 400);
    assertProblemJson(res);
  });

  test('returns 400 problem+json when items is empty', async () => {
    const res = await postOrder({
      key: `empty-items-${randomUUID()}`,
      body: { items: [] },
    });

    assert.equal(res.status, 400);
    assertProblemJson(res);
  });

  test('returns 201 with Location on valid request', async () => {
    const res = await postOrder({
      key: `create-${randomUUID()}`,
      body: { items: [{ product_id: 'product_keyboard', quantity: 1 }] },
    });

    assert.equal(res.status, 201);
    const location = res.headers.get('location');
    assert.ok(location?.startsWith('/orders/'));
    assert.equal(res.headers.get('idempotency-replay'), null);

    const order = await res.json();
    assert.equal(order.status, 'placed');
    assert.ok(Array.isArray(order.items) && order.items.length === 1);
  });

  test('returns 201 with Idempotency-Replay on replay', async () => {
    const key = `replay-${randomUUID()}`;
    const body = { items: [{ product_id: 'product_mouse', quantity: 1 }] };

    const first = await postOrder({ key, body });
    assert.equal(first.status, 201);
    const firstOrder = await first.json();

    const replay = await postOrder({ key, body });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotency-replay'), 'true');
    assert.equal(replay.headers.get('location'), first.headers.get('location'));

    const replayOrder = await replay.json();
    assert.deepEqual(replayOrder, firstOrder);
  });

  test('returns 422 problem+json when same key has different body', async () => {
    const key = `conflict-${randomUUID()}`;

    const first = await postOrder({
      key,
      body: { items: [{ product_id: 'product_stand', quantity: 1 }] },
    });
    assert.equal(first.status, 201);

    const conflict = await postOrder({
      key,
      body: { items: [{ product_id: 'product_webcam', quantity: 1 }] },
    });

    assert.equal(conflict.status, 422);
    assertProblemJson(conflict);
  });
});

describe('GET /products', () => {
  test('returns 200 with items and next_cursor when limit=2', async () => {
    const res = await fetch(`${baseUrl}/products?limit=2`);

    assert.equal(res.status, 200);
    const page = await res.json();
    assert.equal(page.items.length, 2);
    assert.ok(page.next_cursor);
  });

  test('returns next page when cursor is provided', async () => {
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

  test('returns 400 problem+json for invalid cursor', async () => {
    const res = await fetch(`${baseUrl}/products?cursor=invalid`);

    assert.equal(res.status, 400);
    assertProblemJson(res);
  });

  test('returns 404 problem+json when product is not found', async () => {
    const res = await fetch(`${baseUrl}/products/product_does_not_exist`);

    assert.equal(res.status, 404);
    assertProblemJson(res);
  });
});

describe('unknown routes', () => {
  test('returns 404 problem+json', async () => {
    const res = await fetch(`${baseUrl}/unknown-route`);

    assert.equal(res.status, 404);
    assertProblemJson(res);
  });
});
