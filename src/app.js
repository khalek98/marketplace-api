import express from "express";
import OpenApiValidator from "express-openapi-validator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { notFoundHandler, errorHandler } from "./middleware/error-handler.js";
import { productsRouter } from "./routes/products.router.js";
import { ordersRouter } from "./routes/orders.router.js";
import { startServer } from "./bootstrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSpec = resolve(__dirname, "../openapi/openapi.yaml");

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.use(
  OpenApiValidator.middleware({
    apiSpec,
    validateRequests: true,
    validateResponses: true,
  }),
);

app.use("/products", productsRouter);
app.use("/orders", ordersRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  startServer({ app }).then((server) => {
    const { address, port } = server.address();
    const host =
      address === "::" || address === "0.0.0.0" ? "localhost" : address;
    console.log(`Marketplace API listening on http://${host}:${port}`);
  });
}

export { app };
