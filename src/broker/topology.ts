import type { Channel } from "amqplib";

import { EXCHANGE, QUEUE, QUORUM, ROUTING_KEY } from "./names";

/**
 * Consumer-side (or bootstrap) topology. Publisher only knows EXCHANGE.events
 * and ROUTING_KEY — not the queue names.
 *
 * Order: alternate + DLX first, then the topic that points at them, then the
 * work queue with x-dead-letter-exchange, then the binding that makes the
 * routing key mean something.
 */
export async function declareTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(EXCHANGE.unroutable, "fanout", { durable: true });
  await ch.assertQueue(QUEUE.unroutable, { durable: true, arguments: { ...QUORUM } });
  await ch.bindQueue(QUEUE.unroutable, EXCHANGE.unroutable, "");

  await ch.assertExchange(EXCHANGE.dlx, "fanout", { durable: true });
  await ch.assertQueue(QUEUE.orderPlacedDlq, { durable: true, arguments: { ...QUORUM } });
  await ch.bindQueue(QUEUE.orderPlacedDlq, EXCHANGE.dlx, "");

  await ch.assertExchange(EXCHANGE.events, "topic", {
    durable: true,
    alternateExchange: EXCHANGE.unroutable,
  });

  await ch.assertQueue(QUEUE.orderPlaced, {
    durable: true,
    arguments: {
      ...QUORUM,
      "x-dead-letter-exchange": EXCHANGE.dlx,
    },
  });
  await ch.bindQueue(QUEUE.orderPlaced, EXCHANGE.events, ROUTING_KEY.orderPlaced);
}

/** Demos call this so a previous run's queue args cannot cause PRECONDITION_FAILED. */
export async function resetTopology(ch: Channel): Promise<void> {
  for (const name of [QUEUE.orderPlaced, QUEUE.orderPlacedDlq, QUEUE.unroutable]) {
    await ch.deleteQueue(name).catch(() => undefined);
  }
  for (const name of [EXCHANGE.events, EXCHANGE.dlx, EXCHANGE.unroutable]) {
    await ch.deleteExchange(name).catch(() => undefined);
  }
  await declareTopology(ch);
}
