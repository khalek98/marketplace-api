import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * One login's refresh tokens. Reuse of an already-used hash revokes the whole family_id.
 * token_hash is an HMAC, never the raw token.
 */
@Entity("refresh_tokens")
@Index("refresh_tokens_token_hash_uq", ["tokenHash"], { unique: true })
@Index("refresh_tokens_family_live_idx", ["familyId"], { where: `"revoked_at" IS NULL` })
export class RefreshToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "family_id", type: "uuid" })
  familyId!: string;

  @Column({ name: "user_id", type: "bigint" })
  userId!: string;

  @Column({ name: "token_hash", type: "text" })
  tokenHash!: string;

  @Column({ name: "used_at", type: "timestamptz", nullable: true })
  usedAt!: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  /** Copied onto the next rotation so refreshing does not extend the session forever. */
  @Column({ name: "absolute_expires_at", type: "timestamptz" })
  absoluteExpiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
