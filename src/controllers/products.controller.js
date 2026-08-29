import { ApplicationError } from '../errors/application-error.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import { products, findProductById, findProductIndexById } from '../store/products.store.js';

export function listProducts(req, res, next) {
  try {
    const limit = Number(req.query.limit ?? 20);
    let startIndex = 0;

    if (req.query.cursor !== undefined) {
      const after = decodeCursor(req.query.cursor);
      const cursorIndex = findProductIndexById(after);
      if (cursorIndex === -1) {
        throw new ApplicationError(
          400,
          'Invalid cursor',
          'The cursor does not identify a product in the current catalog.',
          'invalid-cursor',
        );
      }
      startIndex = cursorIndex + 1;
    }

    const items = products.slice(startIndex, startIndex + limit);
    const hasNextPage = startIndex + items.length < products.length;
    const nextCursor =
      hasNextPage && items.length > 0
        ? encodeCursor(items[items.length - 1].id)
        : null;

    res.json({ items, next_cursor: nextCursor });
  } catch (error) {
    next(error);
  }
}

export function getProduct(req, res, next) {
  try {
    const product = findProductById(req.params.productId);
    if (!product) {
      throw new ApplicationError(
        404,
        'Product not found',
        `Product '${req.params.productId}' does not exist.`,
        'product-not-found',
      );
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
}
