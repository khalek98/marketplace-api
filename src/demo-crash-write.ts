import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { withChannel } from "./broker/connect";
import { startOrderPlacedConsumer } from "./broker/consume-order-placed";
import { QUEUE } from "./broker/names";
import { relayOutboxUntilEmpty } from "./broker/relay-outbox";
import { resetTopology } from "./broker/topology";
import { CheckoutAbortAfterOutbox, checkoutCart } from "./checkout/checkout";
import dataSource from "./data-source";
import { Order } from "./entities/order.entity";
import { Outbox } from "./entities/outbox.entity";
import { Product } from "./entities/product.entity";
import { User } from "./entities/user.entity";
import { Wallet } from "./entities/wallet.entity";

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function resetDemoState(): Promise<void> {
  await withChannel(async (ch) => {
    await resetTopology(ch);
  });
  await dataSource.query(`DELETE FROM processed_messages`);
  await dataSource.query(`DELETE FROM outbox`);
}

async function main(): Promise<void> {
  await dataSource.initialize();
  await resetDemoState();

  const buyer = await dataSource.getRepository(User).findOne({ where: { email: "buyer11@seed.local" } });
  const product = await dataSource.getRepository(Product).findOne({ where: { name: "Race Test" } });
  if (!buyer || !product) {
    throw new Error("demo:crash-write needs seed data — run npm run seed");
  }

  await dataSource.getRepository(Wallet).update({ userId: buyer.id }, { balanceCents: 100_000_000 });
  await dataSource.getRepository(Product).update({ id: product.id }, { stockQty: 10, status: "active" });

  const ordersBefore = await dataSource.getRepository(Order).count();
  const outboxBefore = await dataSource.getRepository(Outbox).count();

  let deliveries = 0;
  let effect = 0;

  const consumer = await startOrderPlacedConsumer({
    declare: false,
    handlers: {
      onDelivery: () => {
        deliveries += 1;
      },
      onApplied: () => {
        effect += 1;
      },
    },
  });

  let writeFailed = 0;
  try {
    try {
      await checkoutCart({
        buyerId: buyer.id,
        items: [{ productId: product.id, qty: 1 }],
        idempotencyKey: `crash-write-${randomUUID()}`,
        fingerprint: `crash-write-fp:${product.id}`,
        abortAfterOutbox: true,
      });
    } catch (err) {
      if (err instanceof CheckoutAbortAfterOutbox) {
        writeFailed = 1;
      } else {
        throw err;
      }
    }

    const orders = (await dataSource.getRepository(Order).count()) - ordersBefore;
    const outbox = (await dataSource.getRepository(Outbox).count()) - outboxBefore;

    const published = await relayOutboxUntilEmpty({ limit: 32 });

    // Brief settle window — nothing should arrive.
    await new Promise((r) => setTimeout(r, 300));
    const work = await withChannel(async (ch) => (await ch.checkQueue(QUEUE.orderPlaced)).messageCount);

    line("write-failed", writeFailed);
    line("orders", orders);
    line("outbox", outbox);
    line("published", published);
    line("deliveries", deliveries);
    line("effect", effect);

    if (
      writeFailed !== 1 ||
      orders !== 0 ||
      outbox !== 0 ||
      published !== 0 ||
      deliveries !== 0 ||
      effect !== 0 ||
      work !== 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await consumer.stop();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
