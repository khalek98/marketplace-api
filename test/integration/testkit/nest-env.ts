import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartedTestContainer } from "testcontainers";

/**
 * Nest ConfigModule / DatabaseService need DB_URL + auth file in addition to
 * the TypeORM DB_* vars that startMarketplacePg already set.
 */
let signing:
  | {
      kid: string;
      privateKey: string;
      publicKey: string;
    }
  | undefined;
let jobsRedis: StartedTestContainer | undefined;

/** One ES256 pair per process. Not a vault key and not written to the repo. */
function ensureSigningKeys(): void {
  if (!signing) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
    signing = {
      kid: "test-kid",
      privateKey: Buffer.from(String(privatePem)).toString("base64"),
      publicKey: Buffer.from(String(publicPem)).toString("base64"),
    };
  }
  process.env.JWT_KID = signing.kid;
  process.env.JWT_PRIVATE_KEY = signing.privateKey;
  process.env.JWT_PUBLIC_KEY = signing.publicKey;
  process.env.REFRESH_TOKEN_PEPPER = "test-pepper";
}

/** Denylist checks run on every bearer request, so the suite needs a real Redis. */
async function ensureJobsRedis(): Promise<void> {
  if (!jobsRedis) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GenericContainer } = require("testcontainers") as typeof import("testcontainers");
    jobsRedis = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
  }
  const url = `redis://${jobsRedis.getHost()}:${jobsRedis.getMappedPort(6379)}`;
  process.env.REDIS_URL = url;
  process.env.REDIS_QUEUE_URL = url;
}

export async function applyNestTestEnv(): Promise<{ authFile: string; cleanup(): Promise<void> }> {
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
  // Schema still requires a valid amqp URL; Nest HTTP suites do not start RabbitMQ.
  process.env.BROKER_URL = process.env.BROKER_URL || "amqp://app:app@127.0.0.1:21130";
  process.env.SKIP_BROKER = "1";
  process.env.PORT = process.env.PORT || "3000";
  process.env.CURSOR_HMAC_SECRET = process.env.CURSOR_HMAC_SECRET || "e2e-test-cursor-hmac-secret";
  ensureSigningKeys();
  await ensureJobsRedis();
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

  return {
    authFile,
    async cleanup() {
      try {
        unlinkSync(authFile);
      } catch {
        // ignore missing file on repeated cleanup
      }
      if (jobsRedis) {
        const current = jobsRedis;
        jobsRedis = undefined;
        await current.stop();
      }
    },
  };
}
