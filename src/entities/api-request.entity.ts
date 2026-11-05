import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";

import { Order } from "./order.entity";

@Entity("api_requests")
export class ApiRequest {
  @PrimaryColumn({ name: "idempotency_key", type: "text" })
  idempotencyKey!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "order_id" })
  order!: Order;

  /** Canonical body hash — same key + different body → 422 conflict (HW-9). */
  @Column({ type: "text" })
  fingerprint!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
