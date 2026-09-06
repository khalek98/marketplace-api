import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { ProductsModule } from "./products/products.module";
import { OrdersModule } from "./orders/orders.module";

@Module({
  controllers: [AppController],
  imports: [ProductsModule, OrdersModule],
})
export class AppModule {}
