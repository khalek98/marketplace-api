import { Check, Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from "typeorm";

import { Order } from "./order.entity";
import { Product } from "./product.entity";

@Entity("users")
@Check(`"role" IN ('buyer', 'seller')`)
@Check(`length(trim(email)) > 0`)
export class User {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Index({ unique: true })
  @Column({ type: "text" })
  email!: string;

  @Column({ type: "text" })
  role!: "buyer" | "seller";

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @OneToMany(() => Product, (product) => product.seller)
  products!: Product[];

  @OneToMany(() => Order, (order) => order.buyer)
  orders!: Order[];
}
