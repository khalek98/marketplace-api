import dataSource from "../data-source";
import { Job } from "../entities/job.entity";
import { Order } from "../entities/order.entity";
import { OrderItem } from "../entities/order-item.entity";
import { Product } from "../entities/product.entity";
import { User } from "../entities/user.entity";
import { Wallet } from "../entities/wallet.entity";
import { withRetry } from "./with-retry";

export interface CheckoutInput {
  buyerId: string;
  productId: string;
  qty: number;
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

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const { buyerId, productId, qty } = input;

  if (qty <= 0) {
    throw new Error("qty must be > 0");
  }

  // Whole TX from scratch on 40001/40P01 (deadlock if lock order ever diverges).
  return withRetry("checkout", async () => {
    return dataSource.transaction(async (manager) => {
      const stock = await manager
        .createQueryBuilder()
        .update(Product)
        .set({ stockQty: () => "stock_qty - :qty" })
        .where("id = :id", { id: productId })
        .andWhere("stock_qty >= :qty", { qty })
        .andWhere("status = :status", { status: "active" })
        .returning(["id", "name", "priceCents"])
        .execute();

      if (!stock.affected) {
        throw new Error("InsufficientStock");
      }

      const productRow = stock.raw[0] as StockReturning;
      const unitPriceCents = Number(productRow.price_cents);
      const totalAmountCents = unitPriceCents * qty;

      const wallet = await manager
        .createQueryBuilder()
        .update(Wallet)
        .set({ balanceCents: () => "balance_cents - :amount" })
        .where("user_id = :userId", { userId: buyerId })
        .andWhere("balance_cents >= :amount", { amount: totalAmountCents })
        .returning(["userId"])
        .execute();

      if (!wallet.affected) {
        throw new Error("InsufficientFunds");
      }

      const item = manager.create(OrderItem, {
        product: { id: productId } as Product,
        productName: String(productRow.name),
        quantity: qty,
        unitPriceCents,
        lineTotalCents: totalAmountCents,
      });

      const order = manager.create(Order, {
        buyer: { id: buyerId } as User,
        status: "placed",
        currency: "UAH",
        totalAmountCents,
        items: [item],
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
