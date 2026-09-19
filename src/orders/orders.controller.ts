import { Controller, Get, Param, Post, Body, Res, HttpCode, Headers } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CreateOrderRequest } from "./orders.types";
import { Response } from "express";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(":orderId")
  getById(@Param("orderId") orderId: string) {
    return this.ordersService.getById(orderId);
  }

  @Post()
  @HttpCode(201)
  create(
    @Headers("Idempotency-Key") idempotencyKey: string,
    @Body() body: CreateOrderRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.ordersService.create(body, idempotencyKey);
    res.setHeader("Location", result.location);

    if (result.replay) {
      res.setHeader("Idempotency-Replay", "true");
    }
    return result.order;
  }
}
