import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFiles1797000000000 implements MigrationInterface {
  name = "AddFiles1797000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "files" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" bigint NOT NULL,
        "object_key" text NOT NULL,
        "status" text NOT NULL,
        "content_type" text NOT NULL,
        "size_bytes" bigint,
        "upload_id" text,
        "etag" text,
        "purpose" text NOT NULL,
        "product_id" bigint,
        "idempotency_key" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_files" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_files_object_key" UNIQUE ("object_key"),
        CONSTRAINT "CHK_files_status" CHECK ("status" IN ('pending', 'completed')),
        CONSTRAINT "CHK_files_purpose" CHECK ("purpose" IN ('avatar', 'product_photo')),
        CONSTRAINT "CHK_files_purpose_target" CHECK (
          ("purpose" = 'avatar' AND "product_id" IS NULL)
          OR ("purpose" = 'product_photo' AND "product_id" IS NOT NULL)
        ),
        CONSTRAINT "CHK_files_size" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
        CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_files_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(`CREATE INDEX "files_owner_idx" ON "files" ("owner_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "files_owner_idempotency_uq" ON "files" ("owner_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
