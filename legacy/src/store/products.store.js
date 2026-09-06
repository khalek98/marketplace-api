const initialTimestamp = "2026-08-28T12:00:00.000Z";

export const products = [
  {
    id: "product_keyboard",
    seller_id: "seller_aurora",
    name: "Mechanical Keyboard",
    description: "Compact hot-swappable mechanical keyboard.",
    price_cents: 12900,
    stock_qty: 12,
    status: "active",
    created_at: initialTimestamp,
    updated_at: initialTimestamp,
  },
  {
    id: "product_mouse",
    seller_id: "seller_aurora",
    name: "Wireless Mouse",
    description: "Ergonomic wireless mouse with USB-C charging.",
    price_cents: 6900,
    stock_qty: 20,
    status: "active",
    created_at: initialTimestamp,
    updated_at: initialTimestamp,
  },
  {
    id: "product_stand",
    seller_id: "seller_northstar",
    name: "Laptop Stand",
    description: "Adjustable aluminium laptop stand.",
    price_cents: 5400,
    stock_qty: 8,
    status: "active",
    created_at: initialTimestamp,
    updated_at: initialTimestamp,
  },
  {
    id: "product_webcam",
    seller_id: "seller_northstar",
    name: "HD Webcam",
    description: "1080p webcam with a built-in privacy shutter.",
    price_cents: 7900,
    stock_qty: 6,
    status: "active",
    created_at: initialTimestamp,
    updated_at: initialTimestamp,
  },
  {
    id: "product_archived",
    seller_id: "seller_aurora",
    name: "USB Cable",
    description: "Archived USB-C cable listing.",
    price_cents: 900,
    stock_qty: 3,
    status: "archived",
    created_at: initialTimestamp,
    updated_at: initialTimestamp,
  },
  {
    id: "product_lamp",
    seller_id: "seller_northstar",
    name: "Desk Lamp",
    description: "Adjustable LED desk lamp.",
    price_cents: 2400,
    stock_qty: 4,
    status: "active",
    created_at: initialTimestamp,
    updated_at: initialTimestamp,
  },
];

export function findProductById(id) {
  return products.find((product) => product.id === id);
}

export function findProductIndexById(id) {
  return products.findIndex((product) => product.id === id);
}
