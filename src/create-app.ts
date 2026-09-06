import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import { json } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import { AppModule } from "./app.module";
import { ProblemJsonFilter } from "./common/filters/problem-json.filter";

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ProblemJsonFilter());

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable("x-powered-by");
  // Body must be parsed BEFORE openapi-validator (same order as legacy Express).
  expressApp.use(json());
  expressApp.use(
    OpenApiValidator.middleware({
      apiSpec: resolve(process.cwd(), "openapi/openapi.yaml"),
      validateRequests: true,
      validateResponses: true,
    }),
  );

  return app;
}
