import { Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { Subscription } from "rxjs";
import { Server, Socket } from "socket.io";

import { Env } from "../config/env.schema";
import { verifyBuyerToken } from "./buyer-token";
import { OrderEventsService } from "./order-events.service";
import { OrdersService } from "./orders.service";

type JoinBody = {
  orderId?: unknown;
};

type JoinAck = { ok: true; room: string } | { ok: false };

@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(OrdersGateway.name);
  private live?: Subscription;

  constructor(
    private readonly orders: OrdersService,
    private readonly orderEvents: OrderEventsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  afterInit(server: Server): void {
    this.live = this.orderEvents.stream().subscribe((event) => {
      server.to(`orders:${event.orderId}`).emit("order.status", event);
    });
  }

  onModuleDestroy(): void {
    this.live?.unsubscribe();
  }

  handleConnection(client: Socket): void {
    this.logger.log(`+ ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`- ${client.id}`);
  }

  @SubscribeMessage("join")
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: JoinBody): Promise<JoinAck> {
    const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
    const rawToken = client.handshake.auth?.token;
    const buyerId =
      typeof rawToken === "string"
        ? verifyBuyerToken(rawToken, this.config.get("CURSOR_HMAC_SECRET", { infer: true }))
        : null;
    if (!orderId || !buyerId) {
      this.logger.log(`${client.id} join refused`);
      return { ok: false };
    }

    const allowed = await this.orders.ownsOrder(orderId, buyerId);
    if (!allowed) {
      this.logger.log(`${client.id} join refused`);
      return { ok: false };
    }

    const room = `orders:${orderId}`;
    await client.join(room);
    this.logger.log(`${client.id} → ${room}`);
    return { ok: true, room };
  }
}
