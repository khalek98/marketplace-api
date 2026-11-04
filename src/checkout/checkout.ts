import { randomUUID } from "node:crypto";

import { toOrderPlacedEvent } from "../broker/publish-order-placed";
import { ApplicationError } from "../common/errors/application-error";
import dataSource from "../data-source";
import { Job } from "../entities/job.entity";
import { Order } from "../entities/order.entity";
import { OrderItem } from "../entities/order-item.entity";
import { Outbox } from "../entities/outbox.entity";
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
  /** When set with fingerprint — written in the same COMMIT as order+outbox (API-edge idempotency). */
  idempotencyKey?: string;
  fingerprint?: string;
}

export interface CheckoutResult {
  orderId: string;
  outboxId: string;
  replay: boolean;
}

/** Thrown inside the TX when Idempotency-Key already exists — forces full ROLLBACK of the duplicate attempt. */
class IdempotencyKeyTaken extends Error {
  constructor() {
    super("idempotency-key-taken");
    this.name = "IdempotencyKeyTaken";
  }
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
  const { buyerId, items, idempotencyKey, fingerprint } = input;

  if (items.length === 0) {
    throw new ApplicationError(422, "Invalid order", "Order must contain at least one item.", "invalid-order");
  }
  for (const line of items) {
    if (line.qty <= 0) {
      throw new ApplicationError(422, "Invalid quantity", "Quantity must be greater than zero.", "invalid-quantity");
    }
  }
  if (idempotencyKey !== undefined && !fingerprint) {
    throw new ApplicationError(
      500,
      "Internal error",
      "fingerprint is required when idempotencyKey is set.",
      "missing-fingerprint",
    );
  }

  // Whole TX from scratch on 40001/40P01 (deadlock if lock order ever diverges).
  return withRetry("checkout", async () => {
    try {
      return await dataSource.transaction(async (manager) => {
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

        // Same COMMIT as the order: event stays in outbox until a relay publishes it.
        // outbox.id === eventId === future broker messageId (dedup key for consumers).
        const outboxId = randomUUID();
        const payload = toOrderPlacedEvent({
          eventId: outboxId,
          orderId: saved.id,
          buyerId,
          occurredAt: saved.createdAt,
        });
        await manager.save(
          manager.create(Outbox, {
            id: outboxId,
            aggregateType: "Order",
            aggregateId: String(saved.id),
            type: payload.type,
            payload,
            publishedAt: null,
            attempts: 0,
          }),
        );

        // Level 3: key identifies the client's intent. Conflict → roll back this whole TX
        // (order + outbox + stock/wallet) so a retry cannot create a second order.
        if (idempotencyKey) {
          const claimed: { order_id: string }[] = await manager.query(
            `INSERT INTO api_requests (idempotency_key, order_id, fingerprint)
             VALUES ($1, $2, $3)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING order_id`,
            [idempotencyKey, saved.id, fingerprint],
          );
          if (claimed.length === 0) {
            throw new IdempotencyKeyTaken();
          }
        }

        return { orderId: saved.id, outboxId, replay: false };
      });
    } catch (err) {
      if (!(err instanceof IdempotencyKeyTaken) || !idempotencyKey) {
        throw err;
      }

      const prev: { order_id: string; fingerprint: string }[] = await dataSource.query(
        `SELECT order_id, fingerprint FROM api_requests WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      const row = prev[0];
      if (!row) {
        throw err;
      }
      if (fingerprint && row.fingerprint !== fingerprint) {
        throw new ApplicationError(
          422,
          "Idempotency key conflict",
          "This Idempotency-Key was already used with a different request body.",
          "idempotency-key-conflict",
        );
      }

      const outbox: { id: string }[] = await dataSource.query(
        `SELECT id FROM outbox
         WHERE aggregate_type = 'Order' AND aggregate_id = $1 AND type = 'order.placed'
         ORDER BY created_at ASC
         LIMIT 1`,
        [String(row.order_id)],
      );

      return {
        orderId: String(row.order_id),
        outboxId: outbox[0] ? String(outbox[0].id) : "",
        replay: true,
      };
    }
  });
}
