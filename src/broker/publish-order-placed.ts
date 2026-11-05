import { randomUUID } from "node:crypto";

import type { ConfirmChannel } from "amqplib";

import { isBrokerEnabled } from "./broker-enabled";
import { withConfirmChannel } from "./connect";
import { EXCHANGE, ROUTING_KEY } from "./names";

export type OrderPlacedEvent = {
  eventId: string;
  type: "order.placed";
  occurredAt: string;
  orderId: string;
  buyerId: string;
};

/**
 * Stable event contract for outbox payload / consumers.
 * Do not spread an ORM entity — column renames must not become a public API break.
 */
export function toOrderPlacedEvent(input: {
  eventId: string;
  orderId: string;
  buyerId: string;
  occurredAt?: Date | string;
}): OrderPlacedEvent {
  const occurredAt =
    input.occurredAt instanceof Date ? input.occurredAt.toISOString() : (input.occurredAt ?? new Date().toISOString());
  return {
    eventId: input.eventId,
    type: "order.placed",
    occurredAt,
    orderId: String(input.orderId),
    buyerId: String(input.buyerId),
  };
}

/** Publish on an already-open confirm channel. The relay reuses one channel per pass. */
export async function publishOrderPlacedOnChannel(ch: ConfirmChannel, event: OrderPlacedEvent): Promise<void> {
  const ok = ch.publish(EXCHANGE.events, ROUTING_KEY.orderPlaced, Buffer.from(JSON.stringify(event)), {
    contentType: "application/json",
    persistent: true,
    messageId: event.eventId,
    type: event.type,
    timestamp: Math.floor(Date.now() / 1000),
  });
  if (!ok) {
    throw new Error("order.placed publish returned false (write buffer full)");
  }
  await ch.waitForConfirms();
}

/** Publish a ready event (relay / demos). messageId = event.eventId (= outbox id on the happy path). */
export async function publishOrderPlacedEvent(event: OrderPlacedEvent): Promise<void> {
  if (!isBrokerEnabled()) {
    return;
  }

  await withConfirmChannel((ch) => publishOrderPlacedOnChannel(ch, event));
}

/** Direct publish (HW-19 demos). Production path writes outbox in checkout, then relay publishes. */
export async function publishOrderPlaced(input: { orderId: string; buyerId: string }): Promise<OrderPlacedEvent> {
  const event = toOrderPlacedEvent({
    eventId: randomUUID(),
    orderId: input.orderId,
    buyerId: input.buyerId,
  });

  await publishOrderPlacedEvent(event);
  return event;
}
