import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AppController } from "./app.controller";
import { validate } from "./config/env.schema";
import { DatabaseModule } from "./database/database.module";
import { OrdersModule } from "./orders/orders.module";
import { ProductsModule } from "./products/products.module";

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ".env",
    }),
    DatabaseModule,
    ProductsModule,
    OrdersModule,
  ],
})
export class AppModule {}
