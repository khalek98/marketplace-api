import type { DataSource } from "typeorm";

import { ApplicationError } from "../../src/common/errors/application-error";
import { Order } from "../../src/entities/order.entity";
import { OrderItem } from "../../src/entities/order-item.entity";
import { Product } from "../../src/entities/product.entity";
import { User } from "../../src/entities/user.entity";
import { Wallet } from "../../src/entities/wallet.entity";
import { aProduct, aUser, aWallet } from "./testkit/builders";
import { MarketplacePg, pgErrorCode, startMarketplacePg, truncateData } from "./testkit/pg";

/**
 * One container per file: DataSource options are fixed at first import, so a
 * second file cannot re-point the singleton at another ephemeral Postgres.
 */
describe("integration · data layer (testcontainers)", () => {
  let pg: MarketplacePg;
  let ds: DataSource;
  let checkoutCart: typeof import("../../src/checkout/checkout").checkoutCart;

  beforeAll(async () => {
    pg = await startMarketplacePg("(data-layer)");
    ds = pg.dataSource;
    // Same singleton DataSource that checkout.ts required after env was set.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ checkoutCart } = require("../../src/checkout/checkout") as typeof import("../../src/checkout/checkout"));
  }, 120_000);

  beforeEach(async () => {
    await truncateData(ds);
  });

  afterAll(async () => {
    if (pg) await pg.stop();
  });

  describe("users + wallets", () => {
    test("insert user and read it back by id", async () => {
      const created = await aUser().withEmail("ada@example.com").withRole("buyer").insert(ds);
      const found = await ds.getRepository(User).findOneByOrFail({ id: created.id });

      expect(found.email).toBe("ada@example.com");
      expect(found.role).toBe("buyer");
    });

    test("duplicate email hits unique constraint (23505)", async () => {
      await aUser().withEmail("twin@example.com").insert(ds);

      let caught: unknown;
      try {
        await aUser().withEmail("twin@example.com").insert(ds);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      // Postgres unique_violation — mock Map would silently overwrite.
      expect(pgErrorCode(caught)).toBe("23505");
      expect(String(caught)).toMatch(/duplicate key|unique/i);
    });

    test("wallet balance update persists for the same user_id", async () => {
      const buyer = await aUser().withRole("buyer").insert(ds);
      await aWallet().forUser(buyer.id).withBalance(5_000).insert(ds);

      await ds.getRepository(Wallet).update({ userId: buyer.id }, { balanceCents: 4_200 });
      const wallet = await ds.getRepository(Wallet).findOneByOrFail({ userId: buyer.id });

      expect(wallet.balanceCents).toBe(4_200);
    });
  });

  describe("orders + checkout", () => {
    test("order with item can be read back via JOIN (relations)", async () => {
      const seller = await aUser().withRole("seller").insert(ds);
      const buyer = await aUser().withRole("buyer").insert(ds);
      const product = await aProduct().forSeller(seller.id).withName("Keyboard").withPrice(2_500).insert(ds);

      const orderRepo = ds.getRepository(Order);
      const saved = await orderRepo.save(
        orderRepo.create({
          buyer: { id: buyer.id } as never,
          status: "placed",
          currency: "UAH",
          totalAmountCents: 2_500,
          items: [
            ds.getRepository(OrderItem).create({
              product: { id: product.id } as never,
              productName: product.name,
              quantity: 1,
              unitPriceCents: 2_500,
              lineTotalCents: 2_500,
            }),
          ],
        }),
      );

      const loaded = await orderRepo.findOneOrFail({
        where: { id: saved.id },
        relations: { items: true, buyer: true },
      });

      expect(loaded.buyer.id).toBe(buyer.id);
      expect(loaded.items).toHaveLength(1);
      expect(loaded.items[0].productName).toBe("Keyboard");
      expect(loaded.totalAmountCents).toBe(2_500);
    });

    test("order_items FK to missing product raises 23503", async () => {
      const buyer = await aUser().withRole("buyer").insert(ds);
      const orderRepo = ds.getRepository(Order);

      let caught: unknown;
      try {
        await orderRepo.save(
          orderRepo.create({
            buyer: { id: buyer.id } as never,
            status: "placed",
            currency: "UAH",
            totalAmountCents: 100,
            items: [
              ds.getRepository(OrderItem).create({
                product: { id: "999999999" } as never,
                productName: "Ghost",
                quantity: 1,
                unitPriceCents: 100,
                lineTotalCents: 100,
              }),
            ],
          }),
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      // foreign key / constraint — in-memory store would accept the orphan product id.
      expect(pgErrorCode(caught)).toBe("23503");
      expect(String(caught)).toMatch(/foreign key|constraint/i);
    });

    test("checkoutCart reserves stock and wallet; insufficient stock leaves no order", async () => {
      const seller = await aUser().withRole("seller").insert(ds);
      const buyer = await aUser().withRole("buyer").insert(ds);
      await aWallet().forUser(buyer.id).withBalance(50_000).insert(ds);
      const product = await aProduct()
        .forSeller(seller.id)
        .withName("Limited")
        .withPrice(1_000)
        .withStock(2)
        .insert(ds);

      const ok = await checkoutCart({
        buyerId: buyer.id,
        items: [{ productId: product.id, qty: 1 }],
      });
      expect(ok.orderId).toBeTruthy();

      const afterOk = await ds.getRepository(Product).findOneByOrFail({ id: product.id });
      const walletAfterOk = await ds.getRepository(Wallet).findOneByOrFail({ userId: buyer.id });
      expect(afterOk.stockQty).toBe(1);
      expect(walletAfterOk.balanceCents).toBe(49_000);
      expect(await ds.getRepository(Order).count()).toBe(1);

      let refused: unknown;
      try {
        await checkoutCart({
          buyerId: buyer.id,
          items: [{ productId: product.id, qty: 5 }],
        });
      } catch (err) {
        refused = err;
      }

      expect(refused).toBeInstanceOf(ApplicationError);
      expect((refused as ApplicationError).type).toBe("insufficient-stock");

      const afterFail = await ds.getRepository(Product).findOneByOrFail({ id: product.id });
      const walletAfterFail = await ds.getRepository(Wallet).findOneByOrFail({ userId: buyer.id });
      expect(afterFail.stockQty).toBe(1);
      expect(walletAfterFail.balanceCents).toBe(49_000);
      expect(await ds.getRepository(Order).count()).toBe(1);
    });
  });
});
