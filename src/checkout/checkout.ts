import { ApplicationError } from "../common/errors/application-error";
import dataSource from "../data-source";
import { Job } from "../entities/job.entity";
import { Order } from "../entities/order.entity";
import { OrderItem } from "../entities/order-item.entity";
import { Product } from "../entities/product.entity";
import { User } from "../entities/user.entity";
import { Wallet } from "../entities/wallet.entity";
import { withRetry } from "./with-retry";

export interface CheckoutLine {
  productId: string;
  qty: number;
}

export interface CheckoutInput {
  buyerId: string;
  productId: string;
  qty: number;
}

export interface CheckoutCartInput {
  buyerId: string;
  items: CheckoutLine[];
}

export interface CheckoutResult {
  orderId: string;
}

/** Postgres driver RETURNING columns (snake_case), not entity property names. */
type StockReturning = {
  id: string;
  name: string;
  price_cents: number | string;
};

/** Single-line convenience for demos; same transaction path as the cart. */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  return checkoutCart({
    buyerId: input.buyerId,
    items: [{ productId: input.productId, qty: input.qty }],
  });
}

export async function checkoutCart(input: CheckoutCartInput): Promise<CheckoutResult> {
  const { buyerId, items } = input;

  if (items.length === 0) {
    throw new ApplicationError(422, "Invalid order", "Order must contain at least one item.", "invalid-order");
  }
  for (const line of items) {
    if (line.qty <= 0) {
      throw new ApplicationError(422, "Invalid quantity", "Quantity must be greater than zero.", "invalid-quantity");
    }
  }

  // Whole TX from scratch on 40001/40P01 (deadlock if lock order ever diverges).
  return withRetry("checkout", async () => {
    return dataSource.transaction(async (manager) => {
      const reserved: {
        productId: string;
        name: string;
        qty: number;
        unitPriceCents: number;
        lineTotalCents: number;
      }[] = [];
      let totalAmountCents = 0;

      // Stable lock order by product id — reduces deadlock risk under concurrency.
      const ordered = [...items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

      for (const line of ordered) {
        const stock = await manager
          .createQueryBuilder()
          .update(Product)
          .set({ stockQty: () => "stock_qty - :qty" })
          .where("id = :id", { id: line.productId })
          .andWhere("stock_qty >= :qty", { qty: line.qty })
          .andWhere("status = :status", { status: "active" })
          .returning(["id", "name", "priceCents"])
          .execute();

        if (!stock.affected) {
          throw new ApplicationError(
            409,
            "Insufficient stock",
            `Product '${line.productId}' has insufficient stock or is unavailable.`,
            "insufficient-stock",
          );
        }

        const productRow = stock.raw[0] as StockReturning;
        const unitPriceCents = Number(productRow.price_cents);
        const lineTotalCents = unitPriceCents * line.qty;
        totalAmountCents += lineTotalCents;
        reserved.push({
          productId: String(productRow.id),
          name: String(productRow.name),
          qty: line.qty,
          unitPriceCents,
          lineTotalCents,
        });
      }

      const wallet = await manager
        .createQueryBuilder()
        .update(Wallet)
        .set({ balanceCents: () => "balance_cents - :amount" })
        .where("user_id = :userId", { userId: buyerId })
        .andWhere("balance_cents >= :amount", { amount: totalAmountCents })
        .returning(["userId"])
        .execute();

      if (!wallet.affected) {
        throw new ApplicationError(
          409,
          "Insufficient funds",
          `Buyer '${buyerId}' has insufficient wallet balance.`,
          "insufficient-funds",
        );
      }

      const orderItems = reserved.map((r) =>
        manager.create(OrderItem, {
          product: { id: r.productId } as Product,
          productName: r.name,
          quantity: r.qty,
          unitPriceCents: r.unitPriceCents,
          lineTotalCents: r.lineTotalCents,
        }),
      );

      const order = manager.create(Order, {
        buyer: { id: buyerId } as User,
        status: "placed",
        currency: "UAH",
        totalAmountCents,
        items: orderItems,
      });

      const saved = await manager.save(order);

      await manager.save(
        manager.create(Job, {
          payload: { orderId: saved.id, type: "send_receipt" },
          status: "new",
          worker: null,
        }),
      );

      return { orderId: saved.id };
    });
  });
}
