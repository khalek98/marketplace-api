import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import { json } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import { AppModule } from "./app.module";
import { ProblemJsonFilter } from "./common/filters/problem-json.filter";

/** Shared Nest wiring for main.ts and E2E — same filters/validator as production. */
export function configureApp(app: INestApplication): INestApplication {
  app.enableShutdownHooks();
  app.useGlobalFilters(new ProblemJsonFilter());

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable("x-powered-by");
  expressApp.use(json());
  expressApp.use(
    OpenApiValidator.middleware({
      apiSpec: resolve(process.cwd(), "openapi/openapi.yaml"),
      validateRequests: true,
      validateResponses: true,
      // Outside the OpenAPI contract: ops probes, and the Engine.IO handshake on /socket.io/.
      // The validator treats every other path as part of the spec (servers.url is "/") and answers 404.
      ignorePaths: /^\/(health|db)$|^\/socket\.io(?:\/|$)/,
    }),
  );

  return app;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  return configureApp(app);
}
