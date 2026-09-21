import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { OrderItem } from "./order-item.entity";
import { User } from "./user.entity";

@Entity("products")
@Check(`length(trim(name)) > 0`)
@Check(`length(trim(description)) > 0`)
@Check(`"price_cents" >= 0`)
@Check(`"stock_qty" >= 0`)
@Check(`"status" IN ('active', 'archived')`)
export class Product {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  // Seller with sales history must not disappear — DB-level RESTRICT.
  @ManyToOne(() => User, (user) => user.products, { onDelete: "RESTRICT", nullable: false })
  @JoinColumn({ name: "seller_id" })
  seller!: User;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text" })
  description!: string;

  // Money in minor units (cents), not float / numeric dollars.
  @Column({ name: "price_cents", type: "int" })
  priceCents!: number;

  @Column({ name: "stock_qty", type: "int" })
  stockQty!: number;

  @Column({ type: "text" })
  status!: "active" | "archived";

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // GIN on search_vector is added in the migration (step 4), not here.
  @Column({
    name: "search_vector",
    type: "tsvector",
    generatedType: "STORED",
    asExpression: "to_tsvector('simple', name || ' ' || description)",
    nullable: true,
  })
  searchVector!: string | null;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems!: OrderItem[];
}
