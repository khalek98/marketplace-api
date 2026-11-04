import { Logger, OnModuleDestroy } from "@nestjs/common";
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

import { OrderEventsService } from "./order-events.service";
import { OrdersService } from "./orders.service";

type JoinBody = {
  orderId?: unknown;
  buyerId?: unknown;
};

type JoinAck = { ok: true; room: string } | { ok: false };

@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(OrdersGateway.name);
  private live?: Subscription;

  constructor(
    private readonly orders: OrdersService,
    private readonly orderEvents: OrderEventsService,
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
    const buyerId = typeof body?.buyerId === "string" ? body.buyerId.trim() : "";
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
