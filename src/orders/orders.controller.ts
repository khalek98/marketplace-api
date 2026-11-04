import { Controller, Get, Param, Patch, Post, Body, Res, HttpCode, Headers } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { Subscription } from "rxjs";

import { ApplicationError } from "../common/errors/application-error";
import { Env } from "../config/env.schema";
import { buyerIdFromAuthorization } from "./buyer-token";
import { OrderEventsService, OrderStatusEvent } from "./order-events.service";
import { OrdersService } from "./orders.service";
import { CreateOrderRequest, UpdateOrderStatusRequest } from "./orders.types";

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEvents: OrderEventsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get(":orderId/events")
  async events(
    @Param("orderId") orderId: string,
    @Headers("last-event-id") lastEventHeader: string | string[] | undefined,
    @Headers("authorization") authorization: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const secret = this.config.get("CURSOR_HMAC_SECRET", { infer: true });
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    const buyerId = buyerIdFromAuthorization(header, secret);
    if (!buyerId) {
      throw new ApplicationError(
        401,
        "Missing buyer token",
        "Authorization: Bearer <buyer token> is required to read this stream.",
        "missing-buyer-token",
      );
    }

    await this.ordersService.getById(orderId);
    const allowed = await this.ordersService.ownsOrder(orderId, buyerId);
    if (!allowed) {
      throw new ApplicationError(
        403,
        "Not the order owner",
        "The buyer token does not own this order.",
        "not-order-owner",
      );
    }

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

    for (const event of await this.orderEvents.missedAfter(orderId, lastSent)) write(event);
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
