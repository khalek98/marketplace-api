import "reflect-metadata";

import { startOrderPlacedConsumer } from "./broker/consume-order-placed";
import { withChannel } from "./broker/connect";
import { PREFETCH, QUEUE } from "./broker/names";
import { publishOrderPlaced } from "./broker/publish-order-placed";
import { resetTopology } from "./broker/topology";
import dataSource from "./data-source";

const PUBLISH_COUNT = 5;

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function queueDepth(name: string): Promise<number> {
  return withChannel(async (ch) => (await ch.checkQueue(name)).messageCount);
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

async function main(): Promise<void> {
  await dataSource.initialize();

  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const order = await dataSource.query(`SELECT o.id AS order_id, o.buyer_id FROM orders o ORDER BY o.id ASC LIMIT 1`);
  if (!order[0]) {
    throw new Error("demo:publish needs at least one order — run npm run seed");
  }
  const orderId = String(order[0].order_id);
  const buyerId = String(order[0].buyer_id);

  let delivered = 0;
  let effect = 0;
  let acked = 0;

  const consumer = await startOrderPlacedConsumer({
    declare: false,
    handlers: {
      onDelivery: () => {
        delivered += 1;
      },
      onApplied: () => {
        effect += 1;
      },
      onAcked: () => {
        acked += 1;
      },
    },
  });

  let published = 0;
  try {
    for (let i = 0; i < PUBLISH_COUNT; i++) {
      await publishOrderPlaced({ orderId, buyerId });
      published += 1;
    }

    await waitUntil("five acks", () => acked >= PUBLISH_COUNT);

    const work = await queueDepth(QUEUE.orderPlaced);
    const dlq = await queueDepth(QUEUE.orderPlacedDlq);

    line("published", published);
    line("delivered", delivered);
    line("effect", effect);
    line("acked", acked);
    line("dlq", dlq);
    line("prefetch", PREFETCH);

    if (published !== 5 || effect !== 5 || acked !== 5 || delivered !== 5 || dlq !== 0 || work !== 0) {
      process.exitCode = 1;
    }
    if (PREFETCH < 1 || PREFETCH > 2000) {
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
