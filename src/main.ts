import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ProblemJsonFilter } from "./common/filters/problem-json.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalFilters(new ProblemJsonFilter());

  const port = Number(process.env.PORT ?? 3000);

  await app.listen(port);
  console.log(`Marketplace API listening on http://localhost:${port}`);
}

bootstrap();
