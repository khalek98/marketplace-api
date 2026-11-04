import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReviewsAndProductProjection1794000000000 implements MigrationInterface {
  name = "AddReviewsAndProductProjection1794000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No index on product_id on purpose: the card projection must cost real work
    // (avg over many rows), not a fake sleep — same idea as lecture 23 setup.
    await queryRunner.query(
      `CREATE TABLE "reviews" (
        "id" BIGSERIAL NOT NULL,
        "product_id" bigint NOT NULL,
        "rating" int NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_reviews_rating" CHECK ("rating" BETWEEN 1 AND 5),
        CONSTRAINT "PK_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reviews_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );

    // Honest DB-hit journal: written inside product_projection(), not by app counters.
    await queryRunner.query(
      `CREATE TABLE "db_calls" (
        "id" BIGSERIAL NOT NULL,
        "product_id" bigint NOT NULL,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_db_calls" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION product_projection(p_id bigint)
      RETURNS TABLE (
        id bigint,
        name text,
        price_cents int,
        stock_qty int,
        rating numeric,
        reviews bigint
      )
      LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO db_calls (product_id) VALUES (p_id);
        RETURN QUERY
          SELECT
            p.id,
            p.name,
            p.price_cents,
            p.stock_qty,
            COALESCE(round(avg(r.rating)::numeric, 2), 0) AS rating,
            count(r.*) AS reviews
          FROM products p
          LEFT JOIN reviews r ON r.product_id = p.id
          WHERE p.id = p_id
          GROUP BY p.id;
      END
      $fn$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS product_projection(bigint)`);
    await queryRunner.query(`DROP TABLE "db_calls"`);
    await queryRunner.query(`DROP TABLE "reviews"`);
  }
}
