import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

import { Product } from "./product.entity";
import { User } from "./user.entity";

export type FileStatus = "pending" | "completed";
export type FilePurpose = "avatar" | "product_photo";

@Entity("files")
@Check(`"status" IN ('pending', 'completed')`)
@Check(`"purpose" IN ('avatar', 'product_photo')`)
@Check(`("purpose" = 'avatar' AND "product_id" IS NULL) OR ("purpose" = 'product_photo' AND "product_id" IS NOT NULL)`)
@Check(`"size_bytes" IS NULL OR "size_bytes" >= 0`)
@Index("files_owner_idx", ["ownerId"])
@Index("files_owner_idempotency_uq", ["ownerId", "idempotencyKey"], {
  unique: true,
  where: `"idempotency_key" IS NOT NULL`,
})
export class FileRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // RESTRICT: deleting the user must not drop the row while the object still sits in the bucket.
  @ManyToOne(() => User, { onDelete: "RESTRICT", nullable: false })
  @JoinColumn({ name: "owner_id" })
  owner!: User;

  @Column({ name: "owner_id", type: "bigint" })
  ownerId!: string;

  @Column({ name: "object_key", type: "text", unique: true })
  objectKey!: string;

  @Column({ type: "text" })
  status!: FileStatus;

  @Column({ name: "content_type", type: "text" })
  contentType!: string;

  @Column({ name: "size_bytes", type: "bigint", nullable: true })
  sizeBytes!: string | null;

  @Column({ name: "upload_id", type: "text", nullable: true })
  uploadId!: string | null;

  @Column({ type: "text", nullable: true })
  etag!: string | null;

  @Column({ type: "text" })
  purpose!: FilePurpose;

  @ManyToOne(() => Product, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "product_id" })
  product!: Product | null;

  @Column({ name: "product_id", type: "bigint", nullable: true })
  productId!: string | null;

  @Column({ name: "idempotency_key", type: "text", nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
