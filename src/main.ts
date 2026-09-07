import "reflect-metadata";
import { createApp } from "./create-app";
import { Env } from "./config/env.schema";
import { ConfigService } from "@nestjs/config";

async function bootstrap() {
  const app = await createApp();
  const config = app.get(ConfigService<Env, true>);
  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  console.log(`Marketplace API listening on http://localhost:${port}`);
}

bootstrap();
