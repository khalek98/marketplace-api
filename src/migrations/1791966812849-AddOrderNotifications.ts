import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrderNotifications1791966812849 implements MigrationInterface {
  name = "AddOrderNotifications1791966812849";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "order_notifications" (
        "id" BIGSERIAL NOT NULL,
        "event_id" uuid NOT NULL,
        "order_id" bigint NOT NULL,
        "buyer_id" bigint NOT NULL,
        "type" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_notifications" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_order_notifications_event_id" ON "order_notifications" ("event_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_notifications" ADD CONSTRAINT "FK_order_notifications_order"
        FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_notifications" ADD CONSTRAINT "FK_order_notifications_buyer"
        FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_notifications" DROP CONSTRAINT "FK_order_notifications_buyer"`);
    await queryRunner.query(`ALTER TABLE "order_notifications" DROP CONSTRAINT "FK_order_notifications_order"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_order_notifications_event_id"`);
    await queryRunner.query(`DROP TABLE "order_notifications"`);
  }
}
