import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("outbox")
@Index("outbox_unpublished_idx", ["createdAt"], { where: `"published_at" IS NULL` })
export class Outbox {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "aggregate_type", type: "text" })
  aggregateType!: string;

  @Column({ name: "aggregate_id", type: "text" })
  aggregateId!: string;

  @Column({ type: "text" })
  type!: string;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  /** NULL = not yet published by the relay. */
  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  /** When set and still in the future, the relay skips this unpublished row. */
  @Column({ name: "next_attempt_at", type: "timestamptz", nullable: true })
  nextAttemptAt!: Date | null;
}
