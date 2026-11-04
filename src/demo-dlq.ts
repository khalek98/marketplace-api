import "reflect-metadata";

import type { Message } from "amqplib";

import { startOrderPlacedConsumer } from "./broker/consume-order-placed";
import { connectBroker, withChannel } from "./broker/connect";
import { EXCHANGE, QUEUE, ROUTING_KEY } from "./broker/names";
import { resetTopology } from "./broker/topology";
import dataSource from "./data-source";

const DEATH_REASONS = new Set(["rejected", "expired", "maxlen", "delivery_limit"]);

function line(key: string, value: string | number): void {
  console.log(`${key}=${value}`);
}

async function queueDepth(name: string): Promise<number> {
  return withChannel(async (ch) => (await ch.checkQueue(name)).messageCount);
}

function deathReason(msg: Message): string | null {
  const headers = msg.properties.headers ?? {};
  const first = headers["x-first-death-reason"];
  if (typeof first === "string" && DEATH_REASONS.has(first)) return first;

  const deaths = headers["x-death"];
  if (Array.isArray(deaths) && deaths.length > 0) {
    const reason = (deaths[0] as { reason?: string }).reason;
    if (typeof reason === "string" && DEATH_REASONS.has(reason)) return reason;
  }
  return null;
}

async function waitUntil(label: string, pred: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!(await pred())) {
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

  let rejected = 0;
  let effect = 0;

  const consumer = await startOrderPlacedConsumer({
    declare: false,
    handlers: {
      onRejected: () => {
        rejected += 1;
      },
      onApplied: () => {
        effect += 1;
      },
    },
  });

  try {
    // Poison: not a valid order.placed contract — consumer reject(requeue=false) → DLQ.
    const conn = await connectBroker();
    try {
      const ch = await conn.createConfirmChannel();
      ch.publish(EXCHANGE.events, ROUTING_KEY.orderPlaced, Buffer.from('{"poison":true}'), {
        contentType: "application/json",
        persistent: true,
      });
      await ch.waitForConfirms();
      await ch.close();
    } finally {
      await conn.close().catch(() => undefined);
    }

    await waitUntil("message in DLQ", async () => (await queueDepth(QUEUE.orderPlacedDlq)) >= 1);
    await waitUntil("reject counted", () => rejected >= 1);

    const work = await queueDepth(QUEUE.orderPlaced);
    const dlq = await queueDepth(QUEUE.orderPlacedDlq);

    let reason: string | null = null;
    await withChannel(async (ch) => {
      const msg = await ch.get(QUEUE.orderPlacedDlq, { noAck: true });
      if (msg) reason = deathReason(msg);
    });

    line("rejected", rejected);
    line("work", work);
    line("dlq", dlq);
    line("dlq-reason", reason ?? "missing");
    line("effect", effect);

    if (rejected !== 1 || work !== 0 || dlq !== 1 || effect !== 0 || !reason || !DEATH_REASONS.has(reason)) {
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
