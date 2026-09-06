export enum OrderStatus {
  Pending = "pending",
  Placed = "placed",
  Cancelled = "cancelled",
}

export enum Currency {
  USD = "USD",
  EUR = "EUR",
  UAH = "UAH",
}

export type OrderItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

export type Order = {
  id: string;
  status: OrderStatus;
  currency: Currency;
  items: OrderItem[];
  total_cents: number;
  created_at: string;
};

export type CreateOrderItemRequest = {
  product_id: string;
  quantity: number;
};

export type CreateOrderRequest = {
  items: CreateOrderItemRequest[];
};
