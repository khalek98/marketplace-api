import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { BrokerBootstrap } from "./broker/broker.bootstrap";
import { validate } from "./config/env.schema";
import { DatabaseModule } from "./database/database.module";
import { OrdersModule } from "./orders/orders.module";
import { ProductsModule } from "./products/products.module";
import { ReadinessService } from "./readiness.service";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  controllers: [AppController],
  providers: [BrokerBootstrap, ReadinessService],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ".env",
    }),
    DatabaseModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    UploadsModule,
  ],
})
export class AppModule {}
