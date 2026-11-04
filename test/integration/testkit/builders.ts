import type { DataSource } from "typeorm";

import { Product } from "../../../src/entities/product.entity";
import { User } from "../../../src/entities/user.entity";
import { Wallet } from "../../../src/entities/wallet.entity";

let seq = 0;

export class UserBuilder {
  private email = `user-${++seq}@example.com`;
  private role: "buyer" | "seller" = "buyer";

  withEmail(email: string): this {
    this.email = email;
    return this;
  }

  withRole(role: "buyer" | "seller"): this {
    this.role = role;
    return this;
  }

  build(): Pick<User, "email" | "role"> {
    return { email: this.email, role: this.role };
  }

  async insert(ds: DataSource): Promise<User> {
    const repo = ds.getRepository(User);
    return repo.save(repo.create(this.build()));
  }
}

export class WalletBuilder {
  private userId = "";
  private balanceCents = 10_000;

  forUser(userId: string): this {
    this.userId = userId;
    return this;
  }

  withBalance(balanceCents: number): this {
    this.balanceCents = balanceCents;
    return this;
  }

  async insert(ds: DataSource): Promise<Wallet> {
    if (!this.userId) {
      throw new Error("WalletBuilder: call forUser(userId) before insert");
    }
    const repo = ds.getRepository(Wallet);
    return repo.save(
      repo.create({
        userId: this.userId,
        balanceCents: this.balanceCents,
      }),
    );
  }
}

export class ProductBuilder {
  private sellerId = "";
  private name = `Product ${++seq}`;
  private description = "Integration test product";
  private priceCents = 1000;
  private stockQty = 10;
  private status: "active" | "archived" = "active";

  forSeller(sellerId: string): this {
    this.sellerId = sellerId;
    return this;
  }

  withName(name: string): this {
    this.name = name;
    return this;
  }

  withPrice(priceCents: number): this {
    this.priceCents = priceCents;
    return this;
  }

  withStock(stockQty: number): this {
    this.stockQty = stockQty;
    return this;
  }

  withStatus(status: "active" | "archived"): this {
    this.status = status;
    return this;
  }

  async insert(ds: DataSource): Promise<Product> {
    if (!this.sellerId) {
      throw new Error("ProductBuilder: call forSeller(sellerId) before insert");
    }
    const repo = ds.getRepository(Product);
    return repo.save(
      repo.create({
        seller: { id: this.sellerId } as User,
        name: this.name,
        description: this.description,
        priceCents: this.priceCents,
        stockQty: this.stockQty,
        status: this.status,
      }),
    );
  }
}

export const aUser = () => new UserBuilder();
export const aWallet = () => new WalletBuilder();
export const aProduct = () => new ProductBuilder();
