/**
 * demo:rbac — 401 without a token, 403 for the wrong buyer or role, 401 for a resigned payload.
 * The tamper keeps the original signature. A decode-only check would accept role=admin.
 */
import { ChildProcess } from "node:child_process";

import dataSource from "./data-source";
import { Order } from "./entities/order.entity";
import { OrderItem } from "./entities/order-item.entity";
import { Product } from "./entities/product.entity";
import { User } from "./entities/user.entity";
import { call, DEMO_PASSWORD, line, resetDemoUser, startApi, stopApi, tokenPair } from "./auth/demo-harness";

const PORT = 21182;
const BUYER = "demo-rbac-buyer@seed.local";
const OTHER = "demo-rbac-other@seed.local";
const SELLER = "demo-rbac-seller@seed.local";

async function wipeRows(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.query(
    `DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE email LIKE 'demo-rbac-%')`,
  );
  await dataSource.query(
    `DELETE FROM products WHERE seller_id IN (SELECT id FROM users WHERE email LIKE 'demo-rbac-%')`,
  );
  await dataSource.query(`DELETE FROM users WHERE email LIKE 'demo-rbac-%'`);
}

async function cleanup(): Promise<void> {
  await wipeRows();
  if (dataSource.isInitialized) await dataSource.destroy();
}

async function seedOrder(): Promise<string> {
  await resetDemoUser(BUYER);
  await resetDemoUser(OTHER);
  await resetDemoUser(SELLER, "seller");
  const users = dataSource.getRepository(User);
  const buyer = await users.findOneByOrFail({ email: BUYER });
  const seller = await users.findOneByOrFail({ email: SELLER });

  const product = await dataSource.getRepository(Product).save(
    dataSource.getRepository(Product).create({
      seller,
      name: "RBAC demo",
      description: "order owned by the first buyer",
      priceCents: 1000,
      stockQty: 5,
      status: "active",
    }),
  );
  const item = dataSource.getRepository(OrderItem).create({
    product,
    productName: product.name,
    quantity: 1,
    unitPriceCents: product.priceCents,
    lineTotalCents: product.priceCents,
  });
  const order = await dataSource.getRepository(Order).save(
    dataSource.getRepository(Order).create({
      buyer,
      status: "placed",
      currency: "UAH",
      totalAmountCents: product.priceCents,
      items: [item],
    }),
  );
  return order.id;
}

/** Rewrite the payload and keep the old signature. No key involved. */
function tamperRole(access: string): string {
  const t = access.split(".");
  const p = JSON.parse(Buffer.from(t[1], "base64url").toString()) as { role: string };
  p.role = "admin";
  t[1] = Buffer.from(JSON.stringify(p)).toString("base64url");
  return t.join(".");
}

async function main(): Promise<void> {
  let child: ChildProcess | undefined;
  const status = {
    anon: 0,
    own: 0,
    foreign: 0,
    "role-denied": 0,
    "role-allowed": 0,
    tampered: 0,
  };

  try {
    await wipeRows();
    const orderId = await seedOrder();
    child = await startApi(PORT);

    const buyer = tokenPair(
      (await call(PORT, "/auth/login", { method: "POST", json: { email: BUYER, password: DEMO_PASSWORD } })).json,
    );
    const other = tokenPair(
      (await call(PORT, "/auth/login", { method: "POST", json: { email: OTHER, password: DEMO_PASSWORD } })).json,
    );
    const seller = tokenPair(
      (await call(PORT, "/auth/login", { method: "POST", json: { email: SELLER, password: DEMO_PASSWORD } })).json,
    );

    status.anon = (await call(PORT, `/orders/${orderId}`)).status;
    status.own = (await call(PORT, `/orders/${orderId}`, { token: buyer.access })).status;
    status.foreign = (await call(PORT, `/orders/${orderId}`, { token: other.access })).status;

    const patch = { description: "RBAC touch" };
    status["role-denied"] = (
      await call(PORT, "/products/product_keyboard", { method: "PATCH", token: buyer.access, json: patch })
    ).status;
    status["role-allowed"] = (
      await call(PORT, "/products/product_keyboard", { method: "PATCH", token: seller.access, json: patch })
    ).status;
    status.tampered = (
      await call(PORT, `/orders/${orderId}`, { token: tamperRole(buyer.access) })
    ).status;
  } finally {
    for (const [key, value] of Object.entries(status)) line(key, value);
    await stopApi(child);
    await cleanup();
  }

  const ok =
    status.anon === 401 &&
    status.own === 200 &&
    status.foreign === 403 &&
    status["role-denied"] === 403 &&
    (status["role-allowed"] === 200 || status["role-allowed"] === 201) &&
    status.tampered === 401;
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
