import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1789985541925 implements MigrationInterface {
  name = "InitSchema1789985541925";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" BIGSERIAL NOT NULL, "email" text NOT NULL, "role" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_af49972a15d3579dd05a824d1c" CHECK (length(trim(email)) > 0), CONSTRAINT "CHK_9c3fd31152540fbb73e34c5431" CHECK ("role" IN ('buyer', 'seller')), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
    // HW-12: case-insensitive email lookup (UNIQUE stores raw casing).
    await queryRunner.query(`CREATE INDEX "idx_users_email_lower" ON "users" (lower(email))`);

    await queryRunner.query(
      `CREATE TABLE "products" ("id" BIGSERIAL NOT NULL, "name" text NOT NULL, "description" text NOT NULL, "price_cents" integer NOT NULL, "stock_qty" integer NOT NULL, "status" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED, "seller_id" bigint NOT NULL, CONSTRAINT "CHK_621101c3254cf0c1ccb2dbf0b6" CHECK ("status" IN ('active', 'archived')), CONSTRAINT "CHK_cbabec75bca832bf35fb177b6e" CHECK ("stock_qty" >= 0), CONSTRAINT "CHK_febdd8bc5caa5a7b42ac59848f" CHECK ("price_cents" >= 0), CONSTRAINT "CHK_302281d33f41f9ae7ce0514a0e" CHECK (length(trim(description)) > 0), CONSTRAINT "CHK_a3ac5798266c5e0330b181d3f3" CHECK (length(trim(name)) > 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        "shop",
        "public",
        "products",
        "GENERATED_COLUMN",
        "search_vector",
        "to_tsvector('simple', name || ' ' || description)",
      ],
    );
    await queryRunner.query(`CREATE INDEX "idx_products_search_vector" ON "products" USING GIN ("search_vector")`);

    await queryRunner.query(
      `CREATE TABLE "orders" ("id" BIGSERIAL NOT NULL, "status" text NOT NULL, "currency" text NOT NULL DEFAULT 'USD', "total_amount_cents" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "buyer_id" bigint NOT NULL, CONSTRAINT "CHK_48a96b12a825f3b12da22948f1" CHECK ("total_amount_cents" >= 0), CONSTRAINT "CHK_0a971382b6be6425e402795ac2" CHECK ("currency" IN ('USD', 'EUR', 'UAH')), CONSTRAINT "CHK_b148aecbc3c7204b503531f76e" CHECK ("status" IN ('pending', 'placed', 'cancelled')), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_orders_pending_created" ON "orders" ("created_at") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(`CREATE INDEX "idx_orders_buyer_created" ON "orders" ("buyer_id", "created_at" DESC)`);

    await queryRunner.query(
      `CREATE TABLE "order_items" ("id" BIGSERIAL NOT NULL, "product_name" text NOT NULL, "quantity" integer NOT NULL, "unit_price_cents" integer NOT NULL, "line_total_cents" integer NOT NULL, "order_id" bigint NOT NULL, "product_id" bigint NOT NULL, CONSTRAINT "CHK_543b7d6f13a272a6ae55cc85e1" CHECK ("line_total_cents" >= 0), CONSTRAINT "CHK_2b4a0752179d76f51705bbf55b" CHECK ("unit_price_cents" >= 0), CONSTRAINT "CHK_6e5d794f7711186091b3156024" CHECK ("quantity" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_order_items_order_id" ON "order_items" ("order_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_order_items_product_id" ON "order_items" ("product_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_order_items_product_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_order_items_order_id"`);
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP INDEX "public"."idx_orders_buyer_created"`);
    await queryRunner.query(`DROP INDEX "public"."idx_orders_pending_created"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_search_vector"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ["GENERATED_COLUMN", "search_vector", "shop", "public", "products"],
    );
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_email_lower"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
