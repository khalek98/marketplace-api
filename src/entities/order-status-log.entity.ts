import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

/** One status change. `seq` is per order and only grows, including after a process restart. */
@Entity("order_status_events")
export class OrderStatusLog {
  @PrimaryColumn({ name: "order_id", type: "bigint" })
  orderId!: string;

  @PrimaryColumn({ type: "bigint" })
  seq!: string;

  @Column({ type: "text" })
  status!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
