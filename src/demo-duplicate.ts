import "reflect-metadata";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";

import { startOrderPlacedConsumer } from "./broker/consume-order-placed";
import { withChannel } from "./broker/connect";
import { QUEUE } from "./broker/names";
import { publishOrderPlaced } from "./broker/publish-order-placed";
import { resetTopology } from "./broker/topology";
import dataSource from "./data-source";

type ChildEvent = { t: "ready" | "recv" | "effect"; eventId?: string; redelivered?: boolean };

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function waitUntil(label: string, pred: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!(await pred())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function forkConsumerChild(): {
  proc: ChildProcess;
  events: ChildEvent[];
  until: (pred: (e: ChildEvent[]) => boolean, what: string) => Promise<void>;
  kill: () => Promise<void>;
} {
  const events: ChildEvent[] = [];
  const waiters: { pred: (e: ChildEvent[]) => boolean; resolve: () => void }[] = [];

  const proc = fork(path.join(__dirname, "broker", "consumer-child.js"), {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });

  proc.on("message", (m: ChildEvent) => {
    events.push(m);
    for (const w of [...waiters]) {
      if (w.pred(events)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  });

  return {
    proc,
    events,
    until(pred, what) {
      if (pred(events)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), 20_000);
        waiters.push({
          pred,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
    kill() {
      return new Promise((resolve) => {
        proc.once("exit", () => resolve());
        proc.kill("SIGKILL");
      });
    },
  };
}

async function main(): Promise<void> {
  await dataSource.initialize();

  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const order = await dataSource.query(`SELECT o.id AS order_id, o.buyer_id FROM orders o ORDER BY o.id ASC LIMIT 1`);
  if (!order[0]) {
    throw new Error("demo:duplicate needs at least one order — run npm run seed");
  }

  const event = await publishOrderPlaced({
    orderId: String(order[0].order_id),
    buyerId: String(order[0].buyer_id),
  });

  const child = forkConsumerChild();
  await child.until((e) => e.some((x) => x.t === "ready"), "child ready");
  await child.until((e) => e.some((x) => x.t === "effect"), "effect before ack");
  await child.kill();

  await waitUntil("redelivery back in work queue", async () => {
    const depth = await withChannel(async (ch) => (await ch.checkQueue(QUEUE.orderPlaced)).messageCount);
    return depth >= 1;
  });

  let deliveries = child.events.filter((e) => e.t === "recv").length;
  let effect = child.events.filter((e) => e.t === "effect").length;
  let skipped = 0;

  const consumer = await startOrderPlacedConsumer({
    declare: false,
    handlers: {
      onDelivery: () => {
        deliveries += 1;
      },
      onApplied: () => {
        effect += 1;
      },
      onSkipped: () => {
        skipped += 1;
      },
    },
  });

  try {
    await waitUntil("second delivery handled", () => deliveries >= 2 && skipped + effect >= 2);

    // Settle: one row in DB for this eventId.
    const rows = await dataSource.query(`SELECT count(*)::int AS n FROM order_notifications WHERE event_id = $1`, [
      event.eventId,
    ]);
    const effectFinal = rows[0].n as number;

    line("deliveries", deliveries);
    line("effect", effectFinal);
    line("skipped", skipped);

    if (deliveries < 2 || effectFinal !== 1 || skipped < 1) {
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
