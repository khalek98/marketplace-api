import { Controller, Get, Param, Patch, Post, Body, Res, HttpCode, Headers } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CreateOrderRequest, UpdateOrderStatusRequest } from "./orders.types";
import { Response } from "express";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(":orderId")
  getById(@Param("orderId") orderId: string) {
    return this.ordersService.getById(orderId);
  }

  @Patch(":orderId")
  changeStatus(@Param("orderId") orderId: string, @Body() body: UpdateOrderStatusRequest) {
    return this.ordersService.changeStatus(orderId, body.status);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Headers("Idempotency-Key") idempotencyKey: string,
    @Body() body: CreateOrderRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ordersService.create(body, idempotencyKey);
    res.setHeader("Location", result.location);

    if (result.replay) {
      res.setHeader("Idempotency-Replay", "true");
    }
    return result.order;
  }
}
