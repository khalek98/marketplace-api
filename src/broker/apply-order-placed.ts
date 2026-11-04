import dataSource from "../data-source";
import type { OrderPlacedEvent } from "./publish-order-placed";

/** Persist one notification per eventId. Survives process restart; Set/Map would not. */
export async function applyOrderPlaced(event: OrderPlacedEvent): Promise<"applied" | "skipped"> {
  const rows: { id: string }[] = await dataSource.query(
    `INSERT INTO order_notifications (event_id, order_id, buyer_id, type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [event.eventId, event.orderId, event.buyerId, event.type],
  );
  return rows.length > 0 ? "applied" : "skipped";
}
