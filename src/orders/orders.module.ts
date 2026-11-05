import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrderEventsService } from "./order-events.service";
import { OrdersController } from "./orders.controller";
import { OrdersGateway } from "./orders.gateway";
import { OrdersService } from "./orders.service";

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [OrderEventsService, OrdersService, OrdersGateway],
})
export class OrdersModule {}
