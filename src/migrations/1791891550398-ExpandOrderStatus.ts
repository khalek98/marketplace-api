import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandOrderStatus1791891550398 implements MigrationInterface {
  name = "ExpandOrderStatus1791891550398";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "CHK_b148aecbc3c7204b503531f76e"`);
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "CHK_orders_status" CHECK ("status" IN ('pending', 'placed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "CHK_orders_status"`);
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "CHK_b148aecbc3c7204b503531f76e" CHECK ("status" IN ('pending', 'placed', 'cancelled'))`,
    );
  }
}
