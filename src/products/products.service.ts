import { Injectable } from "@nestjs/common";
import { findProductById, findProductIndexById, products } from "./products.store";
import { ApplicationError } from "../common/errors/application-error";
import { decodeCursor, encodeCursor } from "../utils/cursor";
import { Product, ProductPatch } from "./products.types";

const PATCHABLE_FIELDS = ["name", "description", "price_cents", "stock_qty", "status"] as const;
const CATALOG_FIELDS = ["name", "description", "price_cents", "stock_qty"];

@Injectable()
export class ProductsService {
  list(limit: number, cursor?: string): { items: Product[]; next_cursor: string | null } {
    let startIndex = 0;

    if (cursor !== undefined) {
      const after = decodeCursor(cursor);
      const cursorIndex = findProductIndexById(after);
      if (cursorIndex === -1) {
        throw new ApplicationError(
          400,
          "Invalid cursor",
          "The cursor does not identify a product in the current catalog.",
          "invalid-cursor",
        );
      }
      startIndex = cursorIndex + 1;
    }

    const items = products.slice(startIndex, startIndex + limit);
    const hasNextPage = startIndex + items.length < products.length;
    const nextCursor = hasNextPage && items.length > 0 ? encodeCursor(items[items.length - 1].id) : null;

    return { items, next_cursor: nextCursor };
  }

  getById(id: string): Product {
    const product = findProductById(id);

    if (!product) {
      throw new ApplicationError(404, "Product not found", `Product '${id}' does not exist.`, "product-not-found");
    }
    return product;
  }

  update(id: string, patch: ProductPatch): Product {
    const product = findProductById(id);

    if (!product) {
      throw new ApplicationError(404, "Product not found", `Product '${id}' does not exist.`, "product-not-found");
    }

    const touchesCatalog = CATALOG_FIELDS.some((field) => patch[field as keyof ProductPatch] !== undefined);

    if (product.status === "archived" && touchesCatalog) {
      throw new ApplicationError(
        409,
        "Product is archived",
        "Archived products cannot be edited until they are unarchived.",
        "product-archived",
      );
    }

    const nextProduct = { ...product };
    for (const field of PATCHABLE_FIELDS) {
      const value = patch[field];
      if (value !== undefined) {
        Object.assign(nextProduct, { [field]: value });
      }
    }

    if (nextProduct.status === "active" && nextProduct.stock_qty === 0) {
      throw new ApplicationError(
        422,
        "Product cannot be active without stock",
        "A product cannot be activated or kept active with zero stock.",
        "product-active-without-stock",
      );
    }

    for (const field of PATCHABLE_FIELDS) {
      const value = patch[field];
      if (value !== undefined) {
        Object.assign(product, { [field]: value });
      }
    }
    product.updated_at = new Date().toISOString();

    return product;
  }
}
