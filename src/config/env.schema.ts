import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  // Host/port/db/user for pg.Pool. Username is taken from DB_AUTH_FILE.
  DB_URL: z.url({ protocol: /^postgres$/ }),
  // AMQP URL for RabbitMQ (compose publishes 21130). Same secret path as DB_URL.
  BROKER_URL: z.url({ protocol: /^amqps?$/ }),
  // Cache Redis (compose publishes 21140). Same vault path as DB_URL / BROKER_URL.
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // BullMQ / sessions Redis (compose publishes 21141). Separate instance — noeviction.
  REDIS_QUEUE_URL: z.url({ protocol: /^rediss?$/ }),
  // ES256 signing. No defaults: a default here is a key baked into the code.
  JWT_KID: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  REFRESH_TOKEN_PEPPER: z.string().min(1),
  DB_AUTH_FILE: z.string().min(1).default("secrets/db_auth"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  CURSOR_HMAC_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${lines}\nCompare your .env with .env.example.`);
  }
  return parsed.data;
}
