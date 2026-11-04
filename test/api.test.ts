import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { assertProblemJson } from "./helpers";
import { createHttpApp, stopHttpDatabase } from "./http-app";

describe("unknown routes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    await stopHttpDatabase();
  });

  it("returns 404 problem+json", async () => {
    const res = await request(app.getHttpServer()).get("/unknown-route");

    expect(res.status).toBe(404);
    assertProblemJson(res);
  });
});
