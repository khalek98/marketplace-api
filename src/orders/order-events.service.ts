import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export type OrderStatusEvent = {
  id: number;
  orderId: string;
  status: string;
};

const BUFFER_LIMIT = 100;

@Injectable()
export class OrderEventsService {
  private readonly live = new Subject<OrderStatusEvent>();
  private readonly buffers = new Map<string, OrderStatusEvent[]>();
  private readonly nextId = new Map<string, number>();

  publish(orderId: string, status: string): OrderStatusEvent {
    const id = this.nextId.get(orderId) ?? 1;
    this.nextId.set(orderId, id + 1);

    const event: OrderStatusEvent = { id, orderId, status };
    const buffer = this.buffers.get(orderId) ?? [];
    buffer.push(event);
    if (buffer.length > BUFFER_LIMIT) buffer.shift();
    this.buffers.set(orderId, buffer);

    this.live.next(event);
    return event;
  }

  missedAfter(orderId: string, lastEventId: number): OrderStatusEvent[] {
    const buffer = this.buffers.get(orderId) ?? [];
    return buffer.filter((event) => event.id > lastEventId);
  }

  stream(): Observable<OrderStatusEvent> {
    return this.live.asObservable();
  }
}
