import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrderStatusEvents1792300000000 implements MigrationInterface {
  name = "AddOrderStatusEvents1792300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "order_status_events" (
        "order_id" bigint NOT NULL,
        "seq" bigint NOT NULL,
        "status" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_status_events" PRIMARY KEY ("order_id", "seq"),
        CONSTRAINT "CHK_order_status_events_status" CHECK (
          "status" IN ('pending', 'placed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled')
        )
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_status_events" ADD CONSTRAINT "FK_order_status_events_order"
        FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_status_events" DROP CONSTRAINT "FK_order_status_events_order"`);
    await queryRunner.query(`DROP TABLE "order_status_events"`);
  }
}
