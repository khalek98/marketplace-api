import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("jobs")
@Check(`"status" IN ('new', 'done')`)
@Check(`"processed" >= 0`)
@Index("idx_jobs_status", ["status"], { where: `"status" = 'new'` })
export class Job {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "text", default: "new" })
  status!: "new" | "done";

  // Null until a worker claims the job.
  @Column({ type: "text", nullable: true })
  worker!: string | null;

  @Column({ type: "int", default: 0 })
  processed!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
