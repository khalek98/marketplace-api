import { Injectable, OnModuleInit } from "@nestjs/common";

import { ApplicationError } from "../common/errors/application-error";
import dataSource from "../data-source";
import { RefreshToken } from "../entities/refresh-token.entity";
import { User } from "../entities/user.entity";
import { hashPassword, verifyPassword } from "./password";
import { SigningKeysService } from "./signing-keys.service";
import {
  ACCESS_TTL_SEC,
  hashRefreshToken,
  issueAccessToken,
  newFamilyId,
  newRefreshToken,
  REFRESH_ABSOLUTE_SEC,
  REFRESH_IDLE_SEC,
} from "./tokens";

export type LoginResult = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly signing: SigningKeysService) {}

  async onModuleInit(): Promise<void> {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await dataSource
      .getRepository(User)
      .createQueryBuilder("u")
      .where("lower(u.email) = :email", { email: email.trim().toLowerCase() })
      .getOne();

    const stored = user?.passwordHash ?? (await this.placeholderHash());
    const matches = await verifyPassword(password, stored);
    if (!user || !matches) {
      throw new ApplicationError(401, "Invalid credentials", "Invalid email or password.", "invalid-credentials");
    }

    const keys = this.signing.material();
    const access = await issueAccessToken(keys, user);
    const refreshToken = newRefreshToken();
    const now = Date.now();

    await dataSource.getRepository(RefreshToken).save(
      dataSource.getRepository(RefreshToken).create({
        familyId: newFamilyId(),
        userId: user.id,
        tokenHash: hashRefreshToken(keys.pepper, refreshToken),
        usedAt: null,
        revokedAt: null,
        expiresAt: new Date(now + REFRESH_IDLE_SEC * 1000),
        absoluteExpiresAt: new Date(now + REFRESH_ABSOLUTE_SEC * 1000),
      }),
    );

    return {
      access_token: access.token,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SEC,
    };
  }

  private placeholderHash(): Promise<string> {
    this.dummyHash ??= hashPassword("not-a-real-user");
    return this.dummyHash;
  }
}
