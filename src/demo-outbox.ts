import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { ORDER_PLACED_CONSUMER } from "./broker/apply-order-placed";
import { withChannel } from "./broker/connect";
import { startOrderPlacedConsumer } from "./broker/consume-order-placed";
import { QUEUE } from "./broker/names";
import { relayOutboxUntilEmpty } from "./broker/relay-outbox";
import { resetTopology } from "./broker/topology";
import { checkoutCart } from "./checkout/checkout";
import dataSource from "./data-source";
import { Product } from "./entities/product.entity";
import { User } from "./entities/user.entity";
import { Wallet } from "./entities/wallet.entity";

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function waitUntil(label: string, pred: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Wipe relay/consumer scratch state so the demo is self-contained. */
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

  const buyer = await dataSource.getRepository(User).findOne({ where: { email: "buyer10@seed.local" } });
  const product = await dataSource.getRepository(Product).findOne({ where: { name: "Race Test" } });
  if (!buyer || !product) {
    throw new Error("demo:outbox needs seed data — run npm run seed");
  }

  // Enough balance/stock for one line even after prior demos.
  await dataSource.getRepository(Wallet).update({ userId: buyer.id }, { balanceCents: 100_000_000 });
  await dataSource.getRepository(Product).update({ id: product.id }, { stockQty: 10, status: "active" });

  const idempotencyKey = `demo-outbox-${randomUUID()}`;
  const fingerprint = `demo-outbox-fp:${product.id}:1`;
  const items = [{ productId: product.id, qty: 1 }];

  let deliveries = 0;
  let applied = 0;
  let skipped = 0;

  const consumer = await startOrderPlacedConsumer({
    declare: false,
    handlers: {
      onDelivery: () => {
        deliveries += 1;
      },
      onApplied: () => {
        applied += 1;
      },
      onSkipped: () => {
        skipped += 1;
      },
    },
  });

  try {
    const first = await checkoutCart({
      buyerId: buyer.id,
      items,
      idempotencyKey,
      fingerprint,
    });
    const second = await checkoutCart({
      buyerId: buyer.id,
      items,
      idempotencyKey,
      fingerprint,
    });

    const requests = 2;
    const orders = first.orderId === second.orderId && second.replay ? 1 : 0;

    const outboxRows: { n: string }[] = await dataSource.query(
      `SELECT count(*)::text AS n FROM outbox
       WHERE aggregate_type = 'Order' AND aggregate_id = $1 AND type = 'order.placed'`,
      [String(first.orderId)],
    );
    const outbox = Number(outboxRows[0]?.n ?? 0);

    const published = await relayOutboxUntilEmpty({ limit: 32 });

    await waitUntil("consumer applied effect", () => applied + skipped >= 1 && deliveries >= 1);

    const effectRows: { n: string }[] = await dataSource.query(
      `SELECT count(*)::text AS n FROM order_notifications WHERE event_id = $1`,
      [first.outboxId],
    );
    const effect = Number(effectRows[0]?.n ?? 0);

    const processedRows: { n: string }[] = await dataSource.query(
      `SELECT count(*)::text AS n FROM processed_messages
       WHERE message_id = $1 AND consumer = $2`,
      [first.outboxId, ORDER_PLACED_CONSUMER],
    );
    const processed = Number(processedRows[0]?.n ?? 0);

    const work = await withChannel(async (ch) => (await ch.checkQueue(QUEUE.orderPlaced)).messageCount);

    line("requests", requests);
    line("orders", orders);
    line("outbox", outbox);
    line("published", published);
    line("deliveries", deliveries);
    line("effect", effect);
    line("processed", processed);

    if (
      requests !== 2 ||
      orders !== 1 ||
      outbox !== 1 ||
      published !== 1 ||
      effect !== 1 ||
      processed !== 1 ||
      deliveries < 1 ||
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
