const initialTimestamp = '2026-08-28T12:00:00.000Z';

const seedOrder = {
  id: 'order_demo',
  status: 'placed',
  currency: 'USD',
  items: [
    {
      product_id: 'product_mouse',
      product_name: 'Wireless Mouse',
      quantity: 1,
      unit_price_cents: 6900,
      line_total_cents: 6900,
    },
  ],
  total_cents: 6900,
  created_at: initialTimestamp,
};

export const orders = new Map([[seedOrder.id, seedOrder]]);
export const idempotencyRecords = new Map();

let orderSequence = 0;

export function createOrderId() {
  orderSequence += 1;
  return `order_${Date.now().toString(36)}_${orderSequence.toString(36)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
