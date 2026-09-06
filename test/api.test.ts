import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp } from "../src/create-app";
import { assertProblemJson } from "./helpers";

describe("unknown routes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 404 problem+json", async () => {
    const res = await request(app.getHttpServer()).get("/unknown-route");

    expect(res.status).toBe(404);
    assertProblemJson(res);
  });
});
