import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

import { Order } from "./order.entity";
import { User } from "./user.entity";

@Entity("order_notifications")
@Index("UQ_order_notifications_event_id", ["eventId"], { unique: true })
export class OrderNotification {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "event_id", type: "uuid" })
  eventId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "order_id" })
  order!: Order;

  @ManyToOne(() => User, { onDelete: "RESTRICT", nullable: false })
  @JoinColumn({ name: "buyer_id" })
  buyer!: User;

  @Column({ type: "text" })
  type!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
