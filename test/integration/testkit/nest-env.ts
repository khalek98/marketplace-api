import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Nest ConfigModule / DatabaseService need DB_URL + auth file in addition to
 * the TypeORM DB_* vars that startMarketplacePg already set.
 */
export function applyNestTestEnv(): { authFile: string; cleanup(): void } {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;

  if (!host || !port || !user || !password || !database) {
    throw new Error("applyNestTestEnv: call startMarketplacePg first (DB_* must be set)");
  }

  const authFile = join(tmpdir(), `marketplace-e2e-db-auth-${process.pid}.txt`);
  writeFileSync(authFile, `${user}\n${password}\n`, "utf8");

  process.env.DB_URL = `postgres://${encodeURIComponent(user)}@${host}:${port}/${database}`;
  process.env.DB_AUTH_FILE = authFile;
  process.env.PORT = process.env.PORT || "3000";
  process.env.CURSOR_HMAC_SECRET = process.env.CURSOR_HMAC_SECRET || "e2e-test-cursor-hmac-secret";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

  return {
    authFile,
    cleanup() {
      try {
        unlinkSync(authFile);
      } catch {
        // ignore missing file on repeated cleanup
      }
    },
  };
}
