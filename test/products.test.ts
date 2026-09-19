import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp } from "../src/create-app";
import { randomUUID } from "node:crypto";
import { assertProblemJson, postOrder } from "./helpers";

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe("GET /products", () => {
  it("returns 200 with items and next_cursor when limit=2", async () => {
    const res = await request(app.getHttpServer()).get("/products?limit=2");

    expect(res.status).toBe(200);
    const page = await res.body;
    expect(page.items.length).toBe(2);
    expect(page.next_cursor).toBeDefined();
  });

  it("returns next page when cursor is provided", async () => {
    const first = await request(app.getHttpServer()).get("/products?limit=2");
    expect(first.status).toBe(200);
    const firstPage = await first.body;

    const second = await request(app.getHttpServer()).get(
      `/products?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
    );
    expect(second.status).toBe(200);
    const secondPage = await second.body;

    expect(secondPage.items.length).toBe(2);
    expect(secondPage.items[0].id).not.toEqual(firstPage.items[0].id);
  });

  it("returns 400 problem+json for invalid cursor", async () => {
    const res = await request(app.getHttpServer()).get("/products?cursor=invalid");

    expect(res.status).toBe(400);
    assertProblemJson(res);
  });

  it("returns 404 problem+json when product is not found", async () => {
    const res = await request(app.getHttpServer()).get("/products/product_does_not_exist");

    expect(res.status).toBe(404);
    assertProblemJson(res);
  });
});

describe("PATCH /products/{productId}", () => {
  it("returns 200 with updated fields", async () => {
    const name = `Updated Webcam ${randomUUID()}`;
    const res = await request(app.getHttpServer()).patch("/products/product_webcam").send({
      name,
    });

    expect(res.status).toBe(200);
    const product = await res.body;
    expect(product.id).toBe("product_webcam");
    expect(product.name).toBe(name);
    expect(typeof product.updated_at).toBe("string");
  });

  it("returns 409 problem+json when an archived product catalog field is patched", async () => {
    const res = await request(app.getHttpServer()).patch("/products/product_archived").send({
      name: "Should not apply",
    });

    expect(res.status).toBe(409);
    assertProblemJson(res);
    const problem = await res.body;
    expect(problem.type).toMatch(/product-archived/);
  });

  it("returns 422 problem+json when an active product is left with zero stock", async () => {
    const res = await request(app.getHttpServer()).patch("/products/product_lamp").send({
      stock_qty: 0,
    });

    expect(res.status).toBe(422);
    assertProblemJson(res);
    const problem = await res.body;
    expect(problem.type).toMatch(/product-active-without-stock/);
  });

  it("returns 404 problem+json when product is not found", async () => {
    const res = await request(app.getHttpServer()).patch("/products/product_does_not_exist").send({
      name: "Missing product",
    });

    expect(res.status).toBe(404);
    assertProblemJson(res);
  });
});
