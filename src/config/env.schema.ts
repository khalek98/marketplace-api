import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  // Host/port/db/user for pg.Pool. Username is taken from DB_AUTH_FILE.
  DB_URL: z.url({ protocol: /^postgres$/ }),
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
