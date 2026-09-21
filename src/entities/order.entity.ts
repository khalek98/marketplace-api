import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";

import { OrderItem } from "./order-item.entity";
import { User } from "./user.entity";

@Entity("orders")
@Check(`"status" IN ('pending', 'placed', 'cancelled')`)
@Check(`"currency" IN ('USD', 'EUR', 'UAH')`)
@Check(`"total_amount_cents" >= 0`)
@Index("idx_orders_pending_created", ["createdAt"], { where: `"status" = 'pending'` })
export class Order {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  // Keep buyer row while orders exist (history).
  // Composite idx_orders_buyer_created(buyer_id, created_at) is added in the Init migration.
  @ManyToOne(() => User, (user) => user.orders, { onDelete: "RESTRICT", nullable: false })
  @JoinColumn({ name: "buyer_id" })
  buyer!: User;

  @Column({ type: "text" })
  status!: "pending" | "placed" | "cancelled";

  @Column({ type: "text", default: "USD" })
  currency!: "USD" | "EUR" | "UAH";

  @Column({ name: "total_amount_cents", type: "int" })
  totalAmountCents!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  // ORM cascade on save(order) — separate from DB onDelete.
  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];
}
