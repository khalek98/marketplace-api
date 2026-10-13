import { Logger } from "@nestjs/common";
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from "@nestjs/websockets";
import { Socket } from "socket.io";

@WebSocketGateway()
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrdersGateway.name);

  handleConnection(client: Socket): void {
    this.logger.log(`+ ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`- ${client.id}`);
  }
}
