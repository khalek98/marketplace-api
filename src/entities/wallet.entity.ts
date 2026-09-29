import { Check, Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";

import { User } from "./user.entity";

@Entity("wallets")
@Check(`"balance_cents" >= 0`)
export class Wallet {
  @PrimaryColumn({ name: "user_id", type: "bigint" })
  userId!: string;

  @OneToOne(() => User, { onDelete: "RESTRICT", nullable: false })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ name: "balance_cents", type: "int", default: 0 })
  balanceCents!: number;
}
