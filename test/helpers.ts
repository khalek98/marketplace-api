import { INestApplication } from "@nestjs/common";
import request, { Response } from "supertest";

import { TEST_PASSWORD } from "./integration/testkit/builders";

export async function postOrder(
  app: INestApplication,
  options: { key?: string; body: Record<string, unknown>; token?: string },
) {
  const req = request(app.getHttpServer()).post("/orders");
  if (options.token) req.set("Authorization", `Bearer ${options.token}`);
  if (options.key !== undefined) {
    req.set("Idempotency-Key", options.key);
  }
  return await req.send(options.body);
}

/** Login the fixture user. The access token's sub is that user's id. */
export async function loginAccessToken(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password: TEST_PASSWORD });
  if (res.status !== 200 || typeof res.body?.access_token !== "string") {
    throw new Error(`login ${email} failed with ${res.status}`);
  }
  return res.body.access_token;
}

export function assertProblemJson(res: Response) {
  expect(res.headers["content-type"]).toMatch(/problem\+json/);
}
