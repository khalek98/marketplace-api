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
      // Ops probes and the Engine.IO handshake are not in the spec.
      // The SSE stream never ends, so response validation would buffer it forever.
      ignorePaths: /^\/(health|db)$|^\/socket\.io(?:\/|$)|^\/orders\/[^/]+\/events$/,
    }),
  );

  return app;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  return configureApp(app);
}
