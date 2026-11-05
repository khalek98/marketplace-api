import type { DataSource } from "typeorm";

/** Cached projection: product row + aggregate rating (lecture-style heavy read). */
export type ProductCard = {
  id: string;
  name: string;
  priceCents: number;
  stockQty: number;
  rating: string;
  reviews: number;
};

/**
 * Load product card via Postgres function `product_projection`.
 * Each call inserts into `db_calls` inside the DB — that is the honest hit counter.
 */
export async function loadProductCard(ds: DataSource, productId: string | number): Promise<ProductCard> {
  const rows = await ds.query(
    `SELECT id::text AS id, name, price_cents, stock_qty, rating::text AS rating, reviews::text AS reviews
     FROM product_projection($1)`,
    [String(productId)],
  );
  const row = rows[0] as
    | {
        id: string;
        name: string;
        price_cents: number;
        stock_qty: number;
        rating: string;
        reviews: string;
      }
    | undefined;
  if (!row) {
    throw new Error(`product ${productId} not found`);
  }
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    stockQty: row.stock_qty,
    rating: row.rating,
    reviews: Number(row.reviews),
  };
}

export async function resetDbCalls(ds: DataSource): Promise<void> {
  await ds.query(`TRUNCATE db_calls RESTART IDENTITY`);
}

export async function countDbCalls(ds: DataSource, productId?: string | number): Promise<number> {
  if (productId === undefined) {
    const rows = await ds.query(`SELECT count(*)::int AS n FROM db_calls`);
    return Number(rows[0]?.n ?? 0);
  }
  const rows = await ds.query(`SELECT count(*)::int AS n FROM db_calls WHERE product_id = $1`, [String(productId)]);
  return Number(rows[0]?.n ?? 0);
}
