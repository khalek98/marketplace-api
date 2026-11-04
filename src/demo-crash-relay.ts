import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { ORDER_PLACED_CONSUMER } from "./broker/apply-order-placed";
import { withChannel } from "./broker/connect";
import { startOrderPlacedConsumer } from "./broker/consume-order-placed";
import { RelayAbortBeforeUpdate, relayOutboxPass } from "./broker/relay-outbox";
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

async function resetDemoState(): Promise<void> {
  await withChannel(async (ch) => {
    await resetTopology(ch);
  });
  await dataSource.query(`DELETE FROM processed_messages`);
  await dataSource.query(`DELETE FROM outbox`);
}

/**
 * Crash form: simulated abort (throw + ROLLBACK) between publish and UPDATE published_at,
 * same point as lecture step 8 — not a real kill -9. Documented in README (A9).
 */
async function main(): Promise<void> {
  await dataSource.initialize();
  await resetDemoState();

  const buyer = await dataSource.getRepository(User).findOne({ where: { email: "buyer12@seed.local" } });
  const product = await dataSource.getRepository(Product).findOne({ where: { name: "Race Test" } });
  if (!buyer || !product) {
    throw new Error("demo:crash-relay needs seed data — run npm run seed");
  }

  await dataSource.getRepository(Wallet).update({ userId: buyer.id }, { balanceCents: 100_000_000 });
  await dataSource.getRepository(Product).update({ id: product.id }, { stockQty: 10, status: "active" });

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
    const placed = await checkoutCart({
      buyerId: buyer.id,
      items: [{ productId: product.id, qty: 1 }],
      idempotencyKey: `crash-relay-${randomUUID()}`,
      fingerprint: `crash-relay-fp:${product.id}`,
    });

    // Pass 1: publish reaches RabbitMQ, then abort before published_at — row stays unpublished.
    try {
      await relayOutboxPass({ limit: 1, abortBeforeUpdate: true });
      throw new Error("expected RelayAbortBeforeUpdate");
    } catch (err) {
      if (!(err instanceof RelayAbortBeforeUpdate)) {
        throw err;
      }
    }

    const stillUnpublished: { n: string }[] = await dataSource.query(
      `SELECT count(*)::text AS n FROM outbox WHERE id = $1 AND published_at IS NULL`,
      [placed.outboxId],
    );
    if (Number(stillUnpublished[0]?.n) !== 1) {
      throw new Error("outbox row should still be unpublished after abort");
    }

    // Pass 2: same row published again → at-least-once (second delivery).
    const marked = await relayOutboxPass({ limit: 1 });
    if (marked !== 1) {
      throw new Error(`expected 1 row marked published, got ${marked}`);
    }

    await waitUntil("duplicate delivery + single effect", () => deliveries >= 2 && applied + skipped >= 2);

    const effectRows: { n: string }[] = await dataSource.query(
      `SELECT count(*)::text AS n FROM order_notifications WHERE event_id = $1`,
      [placed.outboxId],
    );
    const effect = Number(effectRows[0]?.n ?? 0);

    const processedRows: { n: string }[] = await dataSource.query(
      `SELECT count(*)::text AS n FROM processed_messages
       WHERE message_id = $1 AND consumer = $2`,
      [placed.outboxId, ORDER_PLACED_CONSUMER],
    );
    const processed = Number(processedRows[0]?.n ?? 0);

    const publishedRows: { n: string }[] = await dataSource.query(
      `SELECT count(*)::text AS n FROM outbox WHERE id = $1 AND published_at IS NOT NULL`,
      [placed.outboxId],
    );
    const published = Number(publishedRows[0]?.n ?? 0);

    line("published", published);
    line("deliveries", deliveries);
    line("applied", applied);
    line("effect", effect);
    line("processed", processed);

    if (published !== 1 || deliveries < 2 || applied !== 1 || effect !== 1 || processed !== 1) {
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
