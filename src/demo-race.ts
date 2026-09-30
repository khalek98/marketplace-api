import "reflect-metadata";

import { checkout } from "./checkout/checkout";
import { ApplicationError } from "./common/errors/application-error";
import dataSource from "./data-source";
import { Product } from "./entities/product.entity";
import { User } from "./entities/user.entity";
import { Wallet } from "./entities/wallet.entity";

const ATTEMPTS = 200;
const EXPECTED_STOCK = 10;

function isExpectedCheckoutReject(err: unknown): boolean {
  return err instanceof ApplicationError && (err.type === "insufficient-stock" || err.type === "insufficient-funds");
}

async function main() {
  await dataSource.initialize();

  const product = await dataSource.getRepository(Product).findOne({
    where: { name: "Race Test" },
  });
  if (!product) {
    throw new Error('Seed missing product "Race Test" — run npm run seed');
  }

  await dataSource.getRepository(Product).update({ id: product.id }, { stockQty: EXPECTED_STOCK });
  await dataSource.createQueryBuilder().update(Wallet).set({ balanceCents: 100_000_000 }).execute();

  const buyers = await dataSource
    .getRepository(User)
    .createQueryBuilder("u")
    .where("u.role = :role", { role: "buyer" })
    .orderBy("u.id", "ASC")
    .take(ATTEMPTS)
    .getMany();

  if (buyers.length < ATTEMPTS) {
    throw new Error(`Need ≥${ATTEMPTS} buyers in seed, got ${buyers.length}`);
  }

  const results = await Promise.all(
    buyers.map(async (buyer) => {
      try {
        await checkout({ buyerId: buyer.id, productId: product.id, qty: 1 });
        return true;
      } catch (err) {
        if (isExpectedCheckoutReject(err)) return false;
        throw err;
      }
    }),
  );

  const successes = results.filter(Boolean).length;
  const final = await dataSource.getRepository(Product).findOneOrFail({
    where: { id: product.id },
  });
  const negRows = await dataSource.getRepository(Product).createQueryBuilder("p").where("p.stock_qty < 0").getCount();

  console.log(`спроб: ${ATTEMPTS}`);
  console.log(`успішних: ${successes}`);
  console.log(`фінальний stock: ${final.stockQty}`);
  console.log(`рядків із відʼємним stock: ${negRows}`);

  const ok = successes === EXPECTED_STOCK && final.stockQty === 0 && negRows === 0;
  await dataSource.destroy();

  if (!ok) {
    console.error("інваріант зламано: очікували успішних=10, stock=0, neg=0");
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
