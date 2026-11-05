import { Check, Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from "typeorm";

import { Order } from "./order.entity";
import { Product } from "./product.entity";

@Entity("users")
@Check(`"role" IN ('buyer', 'seller', 'admin')`)
@Check(`length(trim(email)) > 0`)
export class User {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Index({ unique: true })
  @Column({ type: "text" })
  email!: string;

  @Column({ type: "text" })
  role!: "buyer" | "seller" | "admin";

  /** scrypt string (`scrypt$N$r$p$salt$hash`). Never a raw password. */
  @Column({ name: "password_hash", type: "text" })
  passwordHash!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @OneToMany(() => Product, (product) => product.seller)
  products!: Product[];

  @OneToMany(() => Order, (order) => order.buyer)
  orders!: Order[];
}
