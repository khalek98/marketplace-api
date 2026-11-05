import { MigrationInterface, QueryRunner } from "typeorm";

export class OutboxNextAttempt1795000000000 implements MigrationInterface {
  name = "OutboxNextAttempt1795000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "outbox" ADD "next_attempt_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "outbox" DROP COLUMN "next_attempt_at"`);
  }
}
