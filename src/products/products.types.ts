export type ProductStatus = "active" | "archived";

export type Product = {
  id: string;
  seller_id: string;
  name: string;
  description: string;
  price_cents: number;
  stock_qty: number;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
};

export type ProductPatch = Partial<Pick<Product, "name" | "description" | "price_cents" | "stock_qty" | "status">>;
