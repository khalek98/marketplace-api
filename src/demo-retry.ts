// Provoke REPEATABLE READ serialization failure (40001) and survive via withRetry.
import "reflect-metadata";

import { sleep, withRetry } from "./checkout/with-retry";
import dataSource from "./data-source";
import { User } from "./entities/user.entity";
import { Wallet } from "./entities/wallet.entity";

const START_BALANCE = 1000;
const DELTA_A = 50;
const DELTA_B = -30;
const EXPECTED = START_BALANCE + DELTA_A + DELTA_B; // 1020

async function main() {
  await dataSource.initialize();

  const buyer = await dataSource.getRepository(User).findOne({
    where: { email: "buyer1@seed.local" },
  });
  if (!buyer) {
    throw new Error("Seed missing buyer1@seed.local — run npm run seed");
  }

  await dataSource
    .getRepository(Wallet)
    .update({ userId: buyer.id }, { balanceCents: START_BALANCE });

  const transfer = (tag: string, delta: number, thinkMs: number) =>
    withRetry(tag, async () => {
      await dataSource.transaction("REPEATABLE READ", async (manager) => {
        const rows = await manager.query(
          `SELECT balance_cents FROM wallets WHERE user_id = $1`,
          [buyer.id],
        );
        const current = Number(rows[0]?.balance_cents);
        await sleep(thinkMs);
        await manager.query(`UPDATE wallets SET balance_cents = $1 WHERE user_id = $2`, [
          current + delta,
          buyer.id,
        ]);
      });
    });

  await Promise.all([transfer("A", DELTA_A, 100), transfer("B", DELTA_B, 200)]);

  const wallet = await dataSource.getRepository(Wallet).findOneOrFail({
    where: { userId: buyer.id },
  });

  console.log(
    `фінал: balance_cents=${wallet.balanceCents} (очікували ${EXPECTED} = ${START_BALANCE}+${DELTA_A}+${DELTA_B})`,
  );

  await dataSource.destroy();

  if (wallet.balanceCents !== EXPECTED) {
    console.error("арифметика не зійшлась");
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
