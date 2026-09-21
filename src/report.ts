// Domain report that find() cannot express: JOIN + SUM + GROUP BY → getRawMany().
// Boundary: Repository for entity graphs; QueryBuilder when the result is report rows.
import "reflect-metadata";

import dataSource from "./data-source";
import { Product } from "./entities/product.entity";

interface RevenueRow {
  name: string;
  units: string; // SUM/bigint come back as strings from pg
  revenueCents: string;
}

async function main() {
  await dataSource.initialize();

  const report = await dataSource
    .getRepository(Product)
    .createQueryBuilder("p")
    .innerJoin("order_items", "oi", "oi.product_id = p.id")
    .select("p.name", "name")
    .addSelect("SUM(oi.quantity)", "units")
    .addSelect("SUM(oi.quantity * oi.unit_price_cents)", "revenueCents")
    .groupBy("p.id")
    .addGroupBy("p.name")
    .orderBy('"revenueCents"', "DESC")
    .getRawMany<RevenueRow>();

  console.table(
    report.map((r) => ({
      name: r.name,
      units: r.units,
      revenueCents: r.revenueCents,
      revenueUah: Number(r.revenueCents) / 100,
    })),
  );

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
