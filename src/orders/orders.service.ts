import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { checkoutCart } from "../checkout/checkout";
import { ApplicationError } from "../common/errors/application-error";
import dataSource from "../data-source";
import { Order as OrderEntity } from "../entities/order.entity";
import { canonicalize } from "../utils/canonicalize";
import { clone, idempotencyRecords } from "./orders.store";
import { Currency, Order, CreateOrderRequest, OrderStatus } from "./orders.types";

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
  }

  async onModuleDestroy() {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }

  async getById(id: string): Promise<Order> {
    const entity = await dataSource.getRepository(OrderEntity).findOne({
      where: { id },
      relations: { items: { product: true } },
    });
    if (!entity) {
      throw new ApplicationError(404, "Order not found", `Order '${id}' does not exist.`, "order-not-found");
    }
    return this.toHttpOrder(entity);
  }

  async create(
    body: CreateOrderRequest,
    idempotencyKey: string,
  ): Promise<{ order: Order; location: string; replay: boolean }> {
    const fingerprint = canonicalize(body);
    const previous = idempotencyRecords.get(idempotencyKey);

    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new ApplicationError(
          422,
          "Idempotency key conflict",
          "This Idempotency-Key was already used with a different request body.",
          "idempotency-key-conflict",
        );
      }

      return {
        order: clone(previous.body),
        location: previous.location,
        replay: true,
      };
    }

    if (!idempotencyKey?.trim()) {
      throw new ApplicationError(
        400,
        "Missing Idempotency-Key",
        "Header Idempotency-Key is required to create an order.",
        "missing-idempotency-key",
      );
    }

    const { orderId } = await checkoutCart({
      buyerId: body.buyer_id,
      items: body.items.map((item) => ({
        productId: item.product_id,
        qty: item.quantity,
      })),
    });

    const entity = await dataSource.getRepository(OrderEntity).findOneOrFail({
      where: { id: orderId },
      relations: { items: { product: true } },
    });
    const order = this.toHttpOrder(entity);
    const location = `/orders/${order.id}`;

    idempotencyRecords.set(idempotencyKey, {
      fingerprint,
      status: 201,
      location,
      body: clone(order),
    });

    return { order, location, replay: false };
  }

  private toHttpOrder(entity: OrderEntity): Order {
    const currency = entity.currency === "EUR" ? Currency.EUR : entity.currency === "UAH" ? Currency.UAH : Currency.USD;

    return {
      id: String(entity.id),
      status:
        entity.status === "pending"
          ? OrderStatus.Pending
          : entity.status === "cancelled"
            ? OrderStatus.Cancelled
            : OrderStatus.Placed,
      currency,
      items: (entity.items ?? []).map((item) => ({
        product_id: String(item.product.id),
        product_name: item.productName,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
        line_total_cents: item.lineTotalCents,
      })),
      total_cents: entity.totalAmountCents,
      created_at: entity.createdAt.toISOString(),
    };
  }
}
