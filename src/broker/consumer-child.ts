/**
 * Separate process so SIGKILL closes the TCP socket (prod crash), not channel.close().
 * Protocol to parent: ready → recv → effect (applied, ack withheld).
 */
import "reflect-metadata";

import { startOrderPlacedConsumer } from "./consume-order-placed";

type IpcOut = { t: "ready" | "recv" | "effect"; eventId?: string; redelivered?: boolean };

function send(msg: IpcOut): void {
  process.send?.(msg);
}

async function main(): Promise<void> {
  const consumer = await startOrderPlacedConsumer({
    handlers: {
      onDelivery: (msg) => {
        send({
          t: "recv",
          redelivered: msg.fields.redelivered,
          eventId: msg.properties.messageId,
        });
      },
      onApplied: (event) => {
        send({ t: "effect", eventId: event.eventId });
      },
      // Leave unacked so the broker requeues after SIGKILL.
      afterEffect: async () => false,
    },
  });

  send({ t: "ready" });

  process.on("message", async (m: { t?: string }) => {
    if (m?.t === "stop") {
      await consumer.stop();
      process.exit(0);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
