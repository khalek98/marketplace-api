import path from "node:path";

import { MatchersV3, PactV3 } from "@pact-foundation/pact";

const { like, regex, eachLike } = MatchersV3;

/**
 * Imaginary storefront describes what it expects from marketplace-api.
 * Pact mock answers from this description; output is pacts/*.json.
 */
describe("contract · consumer: marketplace-web ↔ marketplace-api", () => {
  const provider = new PactV3({
    consumer: "marketplace-web",
    provider: "marketplace-api",
    dir: path.resolve(process.cwd(), "pacts"),
  });

  test("GET /orders/7 when order 7 exists", async () => {
    provider
      .given("order 7 exists")
      .uponReceiving("a request for order 7")
      .withRequest({ method: "GET", path: "/orders/7" })
      .willRespondWith({
        status: 200,
        headers: {
          "Content-Type": regex("application/json.*", "application/json; charset=utf-8"),
        },
        body: {
          // Decimal string id is a valid ResourceId — do not lock to ULID examples from the spec.
          id: like("7"),
          status: like("placed"),
          currency: regex("^[A-Z]{3}$", "UAH"),
          items: eachLike({
            product_id: like("1"),
            product_name: like("Pact Product"),
            quantity: like(1),
            unit_price_cents: like(2500),
            line_total_cents: like(2500),
          }),
          total_cents: like(2500),
          created_at: regex(
            "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$",
            "2026-01-15T12:00:00.000Z",
          ),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/orders/7`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; status: string; total_cents: number };
      expect(body).toMatchObject({
        id: expect.any(String),
        status: expect.any(String),
        total_cents: expect.any(Number),
      });
    });
  });

  test("POST /orders when buyer 1 can purchase product 1", async () => {
    provider
      .given("buyer 1 can purchase product 1")
      .uponReceiving("a request to create an order")
      .withRequest({
        method: "POST",
        path: "/orders",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "pact-create-1",
        },
        body: {
          buyer_id: "1",
          items: [{ product_id: "1", quantity: 1 }],
        },
      })
      .willRespondWith({
        status: 201,
        headers: {
          "Content-Type": regex("application/json.*", "application/json; charset=utf-8"),
          Location: regex("^/orders/[A-Za-z0-9][A-Za-z0-9_-]*$", "/orders/8"),
        },
        body: {
          id: like("8"),
          status: like("placed"),
          currency: regex("^[A-Z]{3}$", "UAH"),
          items: eachLike({
            product_id: like("1"),
            product_name: like("Pact Product"),
            quantity: like(1),
            unit_price_cents: like(2500),
            line_total_cents: like(2500),
          }),
          total_cents: like(2500),
          created_at: regex(
            "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$",
            "2026-01-15T12:00:00.000Z",
          ),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "pact-create-1",
        },
        body: JSON.stringify({
          buyer_id: "1",
          items: [{ product_id: "1", quantity: 1 }],
        }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get("location")).toMatch(/^\/orders\//);
      const body = (await res.json()) as { id: string; status: string; total_cents: number };
      expect(body).toMatchObject({
        id: expect.any(String),
        status: expect.any(String),
        total_cents: expect.any(Number),
      });
    });
  });
});
