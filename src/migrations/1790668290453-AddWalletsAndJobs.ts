import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWalletsAndJobs1790668290453 implements MigrationInterface {
  name = "AddWalletsAndJobs1790668290453";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wallets" ("user_id" bigint NOT NULL, "balance_cents" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_f000dac1322cfa979bd44cf8ee" CHECK ("balance_cents" >= 0), CONSTRAINT "PK_92558c08091598f7a4439586cda" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "jobs" ("id" BIGSERIAL NOT NULL, "payload" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'new', "worker" text, "processed" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_7389941a629cf5899aee4f2f73" CHECK ("processed" >= 0), CONSTRAINT "CHK_f686108d5d714421bbec6182e4" CHECK ("status" IN ('new', 'done')), CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_jobs_status" ON "jobs" ("status") WHERE "status" = 'new'`);
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD CONSTRAINT "FK_92558c08091598f7a4439586cda" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "FK_92558c08091598f7a4439586cda"`);
    await queryRunner.query(`DROP INDEX "public"."idx_jobs_status"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
  }
}
