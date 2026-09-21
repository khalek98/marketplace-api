import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

import { Order } from "./order.entity";
import { Product } from "./product.entity";

// Order ↔ Product is M:N with payload (qty, prices) → explicit join entity, not @ManyToMany.
@Entity("order_items")
@Check(`"quantity" > 0`)
@Check(`"unit_price_cents" >= 0`)
@Check(`"line_total_cents" >= 0`)
export class OrderItem {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  // Dropped order → line items are meaningless → CASCADE at DB level.
  @ManyToOne(() => Order, (order) => order.items, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "order_id" })
  order!: Order;

  // Product referenced by sales must not be hard-deleted → RESTRICT.
  @ManyToOne(() => Product, (product) => product.orderItems, { onDelete: "RESTRICT", nullable: false })
  @JoinColumn({ name: "product_id" })
  product!: Product;

  // Snapshot of name at purchase time (catalogue rename must not rewrite history).
  @Column({ name: "product_name", type: "text" })
  productName!: string;

  @Column({ type: "int" })
  quantity!: number;

  @Column({ name: "unit_price_cents", type: "int" })
  unitPriceCents!: number;

  @Column({ name: "line_total_cents", type: "int" })
  lineTotalCents!: number;
}
