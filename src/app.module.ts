import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { ProductsModule } from "./products/products.module";
import { OrdersModule } from "./orders/orders.module";
import { ConfigModule } from "@nestjs/config";
import { validate } from "./config/env.schema";

@Module({
  controllers: [AppController],
  imports: [
    ProductsModule,
    OrdersModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ".env",
    }),
  ],
})
export class AppModule {}
