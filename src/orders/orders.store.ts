import { Order, OrderStatus, Currency } from "./orders.types";

type IdempotencyRecord = {
  fingerprint: string;
  status: number;
  location: string;
  body: Order;
};

const initialTimestamp: string = "2026-08-28T12:00:00.000Z";

const seedOrder: Order = {
  id: "order_demo",
  status: OrderStatus.Placed,
  currency: Currency.USD,
  items: [
    {
      product_id: "product_mouse",
      product_name: "Wireless Mouse",
      quantity: 1,
      unit_price_cents: 6900,
      line_total_cents: 6900,
    },
  ],
  total_cents: 6900,
  created_at: initialTimestamp,
};

export const orders: Map<string, Order> = new Map([[seedOrder.id, seedOrder]]);
export const idempotencyRecords: Map<string, IdempotencyRecord> = new Map();

let orderSequence: number = 0;

export function createOrderId(): string {
  orderSequence += 1;
  return `order_${Date.now().toString(36)}_${orderSequence.toString(36)}`;
}

export function clone(value: Order): Order {
  return JSON.parse(JSON.stringify(value));
}

export function findOrderById(id: string): Order | undefined {
  return orders.get(id);
}
