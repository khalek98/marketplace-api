import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

import { ApplicationError } from "../common/errors/application-error";
import dataSource from "../data-source";

export type OrderStatusEvent = {
  id: number;
  orderId: string;
  status: string;
};

@Injectable()
export class OrderEventsService {
  /** Live fan-out for this process. Replay comes from order_status_events, not from here. */
  private readonly live = new Subject<OrderStatusEvent>();

  async publish(orderId: string, status: string): Promise<OrderStatusEvent> {
    const seq = await dataSource.transaction(async (manager) => {
      const locked: Array<{ id: string }> = await manager.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [
        orderId,
      ]);
      if (locked.length === 0) {
        throw new ApplicationError(404, "Order not found", `Order '${orderId}' does not exist.`, "order-not-found");
      }

      const rows: Array<{ seq: string | number }> = await manager.query(
        `INSERT INTO order_status_events (order_id, seq, status)
         SELECT $1::bigint,
                COALESCE((SELECT MAX(seq) FROM order_status_events WHERE order_id = $1::bigint), 0) + 1,
                $2
         RETURNING seq`,
        [orderId, status],
      );
      return Number(rows[0].seq);
    });

    const event: OrderStatusEvent = { id: seq, orderId, status };
    this.live.next(event);
    return event;
  }

  async missedAfter(orderId: string, lastEventId: number): Promise<OrderStatusEvent[]> {
    const rows: Array<{ seq: string | number; status: string }> = await dataSource.query(
      `SELECT seq, status FROM order_status_events
       WHERE order_id = $1 AND seq > $2
       ORDER BY seq`,
      [orderId, lastEventId],
    );
    return rows.map((row) => ({
      id: Number(row.seq),
      orderId,
      status: row.status,
    }));
  }

  stream(): Observable<OrderStatusEvent> {
    return this.live.asObservable();
  }
}
