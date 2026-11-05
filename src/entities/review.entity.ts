import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

import { Product } from "./product.entity";

@Entity("reviews")
@Check(`"rating" BETWEEN 1 AND 5`)
export class Review {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "product_id", type: "bigint" })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "product_id" })
  product!: Product;

  @Column({ type: "int" })
  rating!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
