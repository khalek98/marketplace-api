import { INestApplication } from "@nestjs/common";
import request, { Response } from "supertest";

export async function postOrder(app: INestApplication, options: { key?: string; body: Record<string, unknown> }) {
  const req = request(app.getHttpServer()).post("/orders");
  if (options.key !== undefined) {
    req.set("Idempotency-Key", options.key);
  }
  return await req.send(options.body);
}

export function assertProblemJson(res: Response) {
  expect(res.headers["content-type"]).toMatch(/problem\+json/);
}
