import "reflect-metadata";
import { createApp } from "./create-app";
import { Env, validate } from "./config/env.schema";
import { loadSigningKeys } from "./config/signing-keys";
import { ConfigService } from "@nestjs/config";

function loadLocalEnvFile(): void {
  try {
    // Does not override variables already in the environment.
    process.loadEnvFile(".env");
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code !== "ENOENT") throw err;
  }
}

async function bootstrap() {
  // Name a missing signing key before Nest opens Postgres or Redis.
  loadLocalEnvFile();
  const env = validate(process.env);
  const keys = loadSigningKeys(env);
  console.log(`[jwt] kid=${keys.kid} fp=${keys.fingerprint}`);

  const app = await createApp();
  const config = app.get(ConfigService<Env, true>);
  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  console.log(`Marketplace API listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
