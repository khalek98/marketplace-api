import { ApplicationError } from '../errors/application-error.js';
import { canonicalize } from '../utils/canonicalize.js';
import { findProductById } from '../store/products.store.js';
import {
  orders,
  idempotencyRecords,
  createOrderId,
  clone,
} from '../store/orders.store.js';

export function getOrder(req, res, next) {
  try {
    const order = orders.get(req.params.orderId);
    if (!order) {
      throw new ApplicationError(
        404,
        'Order not found',
        `Order '${req.params.orderId}' does not exist.`,
        'order-not-found',
      );
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
}

export function createOrder(req, res, next) {
  try {
    const idempotencyKey = req.get('Idempotency-Key');
    const fingerprint = canonicalize(req.body);
    const previous = idempotencyRecords.get(idempotencyKey);

    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new ApplicationError(
          422,
          'Idempotency key conflict',
          'This Idempotency-Key was already used with a different request body.',
          'idempotency-key-conflict',
        );
      }

      return res
        .status(previous.status)
        .location(previous.location)
        .set('Idempotency-Replay', 'true')
        .json(clone(previous.body));
    }

    const requestedByProduct = new Map();
    for (const item of req.body.items) {
      requestedByProduct.set(
        item.product_id,
        (requestedByProduct.get(item.product_id) ?? 0) + item.quantity,
      );
    }

    for (const [productId, quantity] of requestedByProduct) {
      const product = findProductById(productId);
      if (!product || product.status !== 'active') {
        throw new ApplicationError(
          422,
          'Product unavailable',
          `Product '${productId}' is not available for ordering.`,
          'product-unavailable',
        );
      }
      if (product.stock_qty < quantity) {
        throw new ApplicationError(
          422,
          'Insufficient stock',
          `Product '${productId}' has insufficient stock.`,
          'insufficient-stock',
        );
      }
    }

    const orderItems = req.body.items.map((requestedItem) => {
      const product = findProductById(requestedItem.product_id);
      const lineTotal = product.price_cents * requestedItem.quantity;

      return {
        product_id: product.id,
        product_name: product.name,
        quantity: requestedItem.quantity,
        unit_price_cents: product.price_cents,
        line_total_cents: lineTotal,
      };
    });
    const totalCents = orderItems.reduce(
      (total, item) => total + item.line_total_cents,
      0,
    );

    if (!Number.isSafeInteger(totalCents)) {
      throw new ApplicationError(
        422,
        'Order total is too large',
        'The order total exceeds the supported monetary range.',
        'order-total-too-large',
      );
    }

    for (const [productId, quantity] of requestedByProduct) {
      const product = findProductById(productId);
      product.stock_qty -= quantity;
      product.updated_at = new Date().toISOString();
    }

    const order = {
      id: createOrderId(),
      status: 'placed',
      currency: 'USD',
      items: orderItems,
      total_cents: totalCents,
      created_at: new Date().toISOString(),
    };
    const location = `/orders/${order.id}`;
    orders.set(order.id, order);
    idempotencyRecords.set(idempotencyKey, {
      fingerprint,
      status: 201,
      location,
      body: clone(order),
    });

    return res.status(201).location(location).json(order);
  } catch (error) {
    return next(error);
  }
}
