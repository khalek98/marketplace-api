/** Topology names for Marketplace async events. Declared by consumer/bootstrap, not the publisher. */

export const EXCHANGE = {
  events: "shop.events",
  unroutable: "shop.unroutable",
  dlx: "shop.dlx",
} as const;

export const QUEUE = {
  orderPlaced: "shop.orders.placed",
  orderPlacedDlq: "shop.orders.placed.dlq",
  unroutable: "shop.unroutable",
} as const;

export const ROUTING_KEY = {
  orderPlaced: "order.placed",
} as const;

/** Unacked delivery window. Applied in the consumer (demo prints this number). */
export const PREFETCH = 20;

export const QUORUM = { "x-queue-type": "quorum" } as const;
