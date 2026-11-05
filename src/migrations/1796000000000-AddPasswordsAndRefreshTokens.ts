import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPasswordsAndRefreshTokens1796000000000 implements MigrationInterface {
  name = "AddPasswordsAndRefreshTokens1796000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "password_hash" text`);
    await queryRunner.query(`UPDATE "users" SET "password_hash" = 'unset' WHERE "password_hash" IS NULL`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_9c3fd31152540fbb73e34c5431"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('buyer', 'seller', 'admin'))`,
    );

    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "family_id" uuid NOT NULL,
        "user_id" bigint NOT NULL,
        "token_hash" text NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "absolute_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "refresh_tokens_token_hash_uq" ON "refresh_tokens" ("token_hash")`);
    await queryRunner.query(
      `CREATE INDEX "refresh_tokens_family_live_idx" ON "refresh_tokens" ("family_id") WHERE "revoked_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_9c3fd31152540fbb73e34c5431" CHECK ("role" IN ('buyer', 'seller'))`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
  }
}
