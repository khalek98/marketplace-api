import { Router } from "express";
import {
  listProducts,
  getProduct,
} from "../controllers/products.controller.js";

export const productsRouter = Router();

productsRouter.get("/", listProducts);
productsRouter.get("/:productId", getProduct);
