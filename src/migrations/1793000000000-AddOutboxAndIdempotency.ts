import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOutboxAndIdempotency1793000000000 implements MigrationInterface {
  name = "AddOutboxAndIdempotency1793000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "aggregate_type" text NOT NULL,
        "aggregate_id" text NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "published_at" TIMESTAMP WITH TIME ZONE,
        "attempts" int NOT NULL DEFAULT 0,
        CONSTRAINT "PK_outbox" PRIMARY KEY ("id")
      )`,
    );
    // Relay only scans unpublished rows; partial index keeps that hot set small.
    await queryRunner.query(
      `CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("created_at") WHERE "published_at" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "processed_messages" (
        "message_id" uuid NOT NULL,
        "consumer" text NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processed_messages" PRIMARY KEY ("message_id", "consumer")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "api_requests" (
        "idempotency_key" text NOT NULL,
        "order_id" bigint NOT NULL,
        "fingerprint" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_api_requests" PRIMARY KEY ("idempotency_key")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_requests" ADD CONSTRAINT "FK_api_requests_order"
        FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_requests" DROP CONSTRAINT "FK_api_requests_order"`);
    await queryRunner.query(`DROP TABLE "api_requests"`);
    await queryRunner.query(`DROP TABLE "processed_messages"`);
    await queryRunner.query(`DROP INDEX "public"."outbox_unpublished_idx"`);
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}
