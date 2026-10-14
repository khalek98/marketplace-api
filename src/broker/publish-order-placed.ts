import { randomUUID } from "node:crypto";

import { withConfirmChannel } from "./connect";
import { EXCHANGE, ROUTING_KEY } from "./names";

export type OrderPlacedEvent = {
  eventId: string;
  type: "order.placed";
  occurredAt: string;
  orderId: string;
  buyerId: string;
};

/** Publish after checkout COMMIT. Does not declare queues — topology is consumer/bootstrap. */
export async function publishOrderPlaced(input: { orderId: string; buyerId: string }): Promise<OrderPlacedEvent> {
  const event: OrderPlacedEvent = {
    eventId: randomUUID(),
    type: "order.placed",
    occurredAt: new Date().toISOString(),
    orderId: input.orderId,
    buyerId: input.buyerId,
  };

  await withConfirmChannel(async (ch) => {
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
  });

  return event;
}
