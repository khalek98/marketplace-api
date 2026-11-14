import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeniedAccessTokens1798000000000 implements MigrationInterface {
  name = "AddDeniedAccessTokens1798000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "denied_access_tokens" (
        "jti" uuid NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_denied_access_tokens" PRIMARY KEY ("jti")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "denied_access_tokens"`);
  }
}
