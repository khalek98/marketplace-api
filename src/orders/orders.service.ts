import { Injectable } from "@nestjs/common";
import { ApplicationError } from "../common/errors/application-error";
import { clone, createOrderId, findOrderById, idempotencyRecords, orders } from "./orders.store";
import { Currency, Order, CreateOrderRequest, OrderStatus } from "./orders.types";
import { findProductById } from "../products/products.store";
import { canonicalize } from "../utils/canonicalize";

@Injectable()
export class OrdersService {
  getById(id: string): Order {
    const order = findOrderById(id);
    if (!order) {
      throw new ApplicationError(404, "Order not found", `Order '${id}' does not exist.`, "order-not-found");
    }
    return order;
  }

  create(body: CreateOrderRequest, idempotencyKey: string): { order: Order; location: string; replay: boolean } {
    if (!idempotencyKey) {
      throw new ApplicationError(
        422,
        "Idempotency key is required",
        "An Idempotency-Key is required to create an order.",
        "idempotency-key-required",
      );
    }
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

    const requestedByProduct = new Map();
    for (const item of body.items) {
      requestedByProduct.set(item.product_id, (requestedByProduct.get(item.product_id) ?? 0) + item.quantity);
    }

    for (const [productId, quantity] of requestedByProduct) {
      const product = findProductById(productId);
      if (!product || product.status !== "active") {
        throw new ApplicationError(
          422,
          "Product unavailable",
          `Product '${productId}' is not available for ordering.`,
          "product-unavailable",
        );
      }
      if (quantity === 0) {
        throw new ApplicationError(
          422,
          "Invalid quantity",
          `Product '${productId}' has an invalid quantity.`,
          "invalid-quantity",
        );
      }
      if (product.stock_qty < quantity) {
        throw new ApplicationError(
          422,
          "Insufficient stock",
          `Product '${productId}' has insufficient stock.`,
          "insufficient-stock",
        );
      }
    }

    const orderItems = body.items.map((requestedItem) => {
      const product = findProductById(requestedItem.product_id);
      if (!product) {
        throw new ApplicationError(
          404,
          "Product not found",
          `Product '${requestedItem.product_id}' does not exist.`,
          "product-not-found",
        );
      }

      const lineTotal = product.price_cents * requestedItem.quantity;

      return {
        product_id: product.id,
        product_name: product.name,
        quantity: requestedItem.quantity,
        unit_price_cents: product.price_cents,
        line_total_cents: lineTotal,
      };
    });

    const totalCents = orderItems.reduce((total, item) => total + item.line_total_cents, 0);

    if (!Number.isSafeInteger(totalCents)) {
      throw new ApplicationError(
        422,
        "Order total is too large",
        "The order total exceeds the supported monetary range.",
        "order-total-too-large",
      );
    }

    for (const [productId, quantity] of requestedByProduct) {
      const product = findProductById(productId);

      if (!product) {
        throw new ApplicationError(
          404,
          "Product not found",
          `Product '${productId}' does not exist.`,
          "product-not-found",
        );
      }

      product.stock_qty -= quantity;
      product.updated_at = new Date().toISOString();
    }

    const newOrder: Order = {
      id: createOrderId(),
      status: OrderStatus.Placed,
      currency: Currency.USD,
      items: orderItems,
      total_cents: totalCents,
      created_at: new Date().toISOString(),
    };

    const location = `/orders/${newOrder.id}`;
    orders.set(newOrder.id, newOrder);
    idempotencyRecords.set(idempotencyKey, {
      fingerprint,
      status: 201,
      location,
      body: clone(newOrder),
    });

    return {
      order: newOrder,
      location,
      replay: false,
    };
  }
}
