import "reflect-metadata";
import { createApp } from "./create-app";

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Marketplace API listening on http://localhost:${port}`);
}

bootstrap();
