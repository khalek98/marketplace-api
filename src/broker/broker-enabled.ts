/** Nest HTTP tests (Pact/e2e) set SKIP_BROKER=1 — no RabbitMQ in those jobs. */
export function isBrokerEnabled(): boolean {
  return process.env.SKIP_BROKER !== "1";
}
