import "reflect-metadata";

import dataSource from "./data-source";
import { Order } from "./entities/order.entity";
import { OrderItem } from "./entities/order-item.entity";
import { Product } from "./entities/product.entity";
import { User } from "./entities/user.entity";
import { Wallet } from "./entities/wallet.entity";

const SELLERS = [
  { email: "seller1@seed.local", role: "seller" as const },
  { email: "seller2@seed.local", role: "seller" as const },
];

const BUYERS_COUNT = 50;

const PRODUCTS = [
  { name: "Клавіатура", description: "механічна клавіатура", priceCents: 120_000, stockQty: 50 },
  { name: "Мишка", description: "бездротова мишка", priceCents: 45_000, stockQty: 80 },
  { name: "Монітор", description: "27 дюймів IPS", priceCents: 780_000, stockQty: 12 },
  { name: "Ноутбук", description: "ноутбук для розробки", priceCents: 4_200_000, stockQty: 5 },
  { name: "Хаб USB-C", description: "хаб на 7 портів", priceCents: 89_000, stockQty: 30 },
  { name: "Race Test", description: "товар для тестування race", priceCents: 1000, stockQty: 10 },
];

const ORDER_COUNT = 10;

async function upsertUser(email: string, role: User["role"]): Promise<User> {
  const repo = dataSource.getRepository(User);
  let user = await repo.findOne({ where: { email } });
  if (!user) {
    user = await repo.save(repo.create({ email, role }));
  }
  return user;
}

async function upsertWallet(buyer: User, balanceCents: number): Promise<void> {
  const repo = dataSource.getRepository(Wallet);
  let wallet = await repo.findOne({ where: { userId: buyer.id } });
  if (!wallet) {
    wallet = repo.create({ userId: buyer.id, user: buyer, balanceCents });
  } else {
    wallet.balanceCents = balanceCents; // щоб після race знову був надлишок
  }
  await repo.save(wallet);
}

async function upsertProduct(seller: User, spec: (typeof PRODUCTS)[number]): Promise<Product> {
  const repo = dataSource.getRepository(Product);
  let product = await repo.findOne({
    where: { name: spec.name, seller: { id: seller.id } },
  });
  if (!product) {
    product = await repo.save(
      repo.create({
        seller,
        name: spec.name,
        description: spec.description,
        priceCents: spec.priceCents,
        stockQty: spec.stockQty,
        status: "active",
      }),
    );
  }
  return product;
}

async function countRows(): Promise<Record<string, number>> {
  return {
    users: await dataSource.getRepository(User).count(),
    products: await dataSource.getRepository(Product).count(),
    orders: await dataSource.getRepository(Order).count(),
    order_items: await dataSource.getRepository(OrderItem).count(),
    wallets: await dataSource.getRepository(Wallet).count(),
  };
}

async function main() {
  await dataSource.initialize();

  const before = await countRows();
  console.log("seed: counts before", before);

  const sellers: User[] = [];
  for (const s of SELLERS) {
    sellers.push(await upsertUser(s.email, s.role));
  }
  const buyers: User[] = [];
  for (let i = 0; i < BUYERS_COUNT; i++) {
    const email = `buyer${i + 1}@seed.local`;
    buyers.push(await upsertUser(email, "buyer"));
  }

  // add wallet for each buyer with balance 100000000
  for (const b of buyers) {
    await upsertWallet(b, 100_000_000);
  }

  const products: Product[] = [];
  for (let i = 0; i < PRODUCTS.length; i++) {
    const seller = sellers[i % sellers.length];
    products.push(await upsertProduct(seller, PRODUCTS[i]));
  }

  const buyerEmails = buyers.map((b) => b.email);
  const existingOrders = await dataSource
    .getRepository(Order)
    .createQueryBuilder("o")
    .innerJoin("o.buyer", "b")
    .where("b.email IN (:...emails)", { emails: buyerEmails })
    .getCount();

  if (existingOrders === 0) {
    const orderRepo = dataSource.getRepository(Order);
    for (let i = 0; i < ORDER_COUNT; i++) {
      const buyer = buyers[i % buyers.length];
      const a = products[i % products.length];
      const b = products[(i + 2) % products.length];
      const qtyA = (i % 3) + 1;
      const qtyB = 1;
      const lineA = qtyA * a.priceCents;
      const lineB = qtyB * b.priceCents;

      const itemA = orderRepo.manager.create(OrderItem, {
        product: a,
        productName: a.name,
        quantity: qtyA,
        unitPriceCents: a.priceCents,
        lineTotalCents: lineA,
      });
      const itemB = orderRepo.manager.create(OrderItem, {
        product: b,
        productName: b.name,
        quantity: qtyB,
        unitPriceCents: b.priceCents,
        lineTotalCents: lineB,
      });

      const order = orderRepo.create({
        buyer,
        status: i % 5 === 0 ? "pending" : "placed",
        currency: "UAH",
        totalAmountCents: lineA + lineB,
        items: [itemA, itemB],
      });
      await orderRepo.save(order);
    }
    console.log(`seed: created ${ORDER_COUNT} orders (with items via cascade)`);
  } else {
    console.log(`seed: orders already present (${existingOrders}) — skip creating more`);
  }

  const after = await countRows();
  console.log("seed: counts after", after);
  console.log(
    "seed: done (idempotent). Check: SELECT count(*) FROM users; SELECT count(*) FROM products; SELECT count(*) FROM orders; SELECT count(*) FROM order_items;",
  );
  console.log("seed: wallets", await dataSource.getRepository(Wallet).find());

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
