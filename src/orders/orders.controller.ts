import { Controller, Get, Param, Patch, Post, Body, Res, HttpCode, Headers } from "@nestjs/common";
import { Response } from "express";
import { Subscription } from "rxjs";

import { OrderEventsService, OrderStatusEvent } from "./order-events.service";
import { OrdersService } from "./orders.service";
import { CreateOrderRequest, UpdateOrderStatusRequest } from "./orders.types";

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  @Get(":orderId/events")
  async events(
    @Param("orderId") orderId: string,
    @Headers("last-event-id") lastEventHeader: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.ordersService.getById(orderId);

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");

    let lastSent = parseLastEventId(lastEventHeader);
    const pending: OrderStatusEvent[] = [];
    let replaying = true;

    const write = (event: OrderStatusEvent) => {
      if (res.destroyed || res.writableEnded || event.id <= lastSent) return;
      res.write(`id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify(event)}\n\n`);
      lastSent = event.id;
    };

    const subscription: Subscription = this.orderEvents.stream().subscribe((event) => {
      if (event.orderId !== orderId) return;
      if (replaying) {
        pending.push(event);
        return;
      }
      write(event);
    });
    res.on("close", () => subscription.unsubscribe());

    for (const event of this.orderEvents.missedAfter(orderId, lastSent)) write(event);
    replaying = false;
    for (const event of pending) write(event);
  }

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

function parseLastEventId(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
