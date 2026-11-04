import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";

import dataSource from "../data-source";
import { applyOrderPlaced } from "./apply-order-placed";
import { connectBroker, brokerUrlFromEnv } from "./connect";
import { PREFETCH, QUEUE } from "./names";
import type { OrderPlacedEvent } from "./publish-order-placed";
import { declareTopology } from "./topology";

export type OrderPlacedConsumeHandlers = {
  onDelivery?: (msg: ConsumeMessage) => void;
  onApplied?: (event: OrderPlacedEvent) => void;
  onSkipped?: (event: OrderPlacedEvent) => void;
  onAcked?: (event: OrderPlacedEvent) => void;
  onRejected?: (msg: ConsumeMessage) => void;
  /** Return false to skip ack (e.g. crash-before-ack demos). Default: always ack. */
  afterEffect?: (event: OrderPlacedEvent, result: "applied" | "skipped") => Promise<boolean> | boolean;
};

export type OrderPlacedConsumer = {
  connection: ChannelModel;
  channel: Channel;
  stop: () => Promise<void>;
};

function parseOrderPlaced(content: Buffer): OrderPlacedEvent | null {
  try {
    const raw: unknown = JSON.parse(content.toString("utf8"));
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (
      typeof o.eventId !== "string" ||
      o.type !== "order.placed" ||
      typeof o.orderId !== "string" ||
      typeof o.buyerId !== "string" ||
      typeof o.occurredAt !== "string"
    ) {
      return null;
    }
    return {
      eventId: o.eventId,
      type: "order.placed",
      occurredAt: o.occurredAt,
      orderId: o.orderId,
      buyerId: o.buyerId,
    };
  } catch {
    return null;
  }
}

async function ensureDataSource(): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
}

/**
 * Manual ack after the DB effect. Prefetch is set before consume.
 * Invalid bodies are rejected without requeue (DLQ path); demos prove that in step 8.
 */
export async function startOrderPlacedConsumer(options?: {
  url?: string;
  handlers?: OrderPlacedConsumeHandlers;
  declare?: boolean;
}): Promise<OrderPlacedConsumer> {
  await ensureDataSource();

  const connection = await connectBroker(options?.url ?? brokerUrlFromEnv());
  const channel = await connection.createChannel();
  const handlers = options?.handlers ?? {};

  if (options?.declare !== false) {
    await declareTopology(channel);
  }

  await channel.prefetch(PREFETCH);

  const { consumerTag } = await channel.consume(
    QUEUE.orderPlaced,
    async (msg) => {
      if (!msg) return;

      handlers.onDelivery?.(msg);

      const event = parseOrderPlaced(msg.content);
      if (!event) {
        channel.reject(msg, false);
        handlers.onRejected?.(msg);
        return;
      }

      try {
        const result = await applyOrderPlaced(event);
        if (result === "applied") handlers.onApplied?.(event);
        else handlers.onSkipped?.(event);

        const shouldAck = (await handlers.afterEffect?.(event, result)) ?? true;
        if (!shouldAck) return;

        channel.ack(msg);
        handlers.onAcked?.(event);
      } catch {
        // Transient failure: requeue. Poison shape is rejected above (noAck path to DLQ).
        channel.nack(msg, false, true);
      }
    },
    { noAck: false },
  );

  return {
    connection,
    channel,
    async stop() {
      try {
        await channel.cancel(consumerTag);
      } catch {
        // channel may already be closed
      }
      await channel.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
    },
  };
}

export { parseOrderPlaced, PREFETCH };
