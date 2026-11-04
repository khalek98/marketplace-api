import dataSource from "../data-source";
import type { OrderPlacedEvent } from "./publish-order-placed";

/** Inbox consumer name — same message may be processed by different consumers later. */
export const ORDER_PLACED_CONSUMER = "order-placed-notifications";

/**
 * Idempotent effect for order.placed:
 * - Level 2 (inbox): processed_messages ON CONFLICT DO NOTHING
 * - Level 1 (natural key): order_notifications unique(event_id)
 * Mark + effect share one Postgres transaction (Redis mark = dual write again).
 */
export async function applyOrderPlaced(event: OrderPlacedEvent): Promise<"applied" | "skipped"> {
  return dataSource.transaction(async (manager) => {
    const inbox: { message_id: string }[] = await manager.query(
      `INSERT INTO processed_messages (message_id, consumer)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING message_id`,
      [event.eventId, ORDER_PLACED_CONSUMER],
    );

    if (inbox.length === 0) {
      return "skipped";
    }

    // Belt-and-suspenders: even if inbox is purged, natural key still blocks a double effect.
    const effect: { id: string }[] = await manager.query(
      `INSERT INTO order_notifications (event_id, order_id, buyer_id, type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [event.eventId, event.orderId, event.buyerId, event.type],
    );

    return effect.length > 0 ? "applied" : "skipped";
  });
}
