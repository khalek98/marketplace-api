import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EntityManager } from "typeorm";

import { ApplicationError } from "../common/errors/application-error";
import type { SigningMaterial } from "../config/signing-keys";
import dataSource from "../data-source";
import { RefreshToken } from "../entities/refresh-token.entity";
import { User } from "../entities/user.entity";
import { Denylist } from "./denylist";
import { hashPassword, verifyPassword } from "./password";
import { SigningKeysService } from "./signing-keys.service";
import {
  ACCESS_TTL_SEC,
  denyTtlSec,
  hashRefreshToken,
  issueAccessToken,
  newFamilyId,
  newRefreshToken,
  REFRESH_ABSOLUTE_SEC,
  REFRESH_GRACE_MS,
  REFRESH_IDLE_SEC,
} from "./tokens";

export type LoginResult = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
};

type StoredRefresh = {
  id: string;
  family_id: string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
  expires_at: Date | string;
  absolute_expires_at: Date | string;
};

function invalidRefresh(): ApplicationError {
  return new ApplicationError(401, "Invalid refresh token", "The refresh token is not valid.", "invalid-refresh-token");
}

/** TypeORM gives UPDATE … RETURNING back as [rows, rowCount], and SELECT as rows. */
function statementRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw) && Array.isArray(raw[0]) && typeof raw[1] === "number") {
    return raw[0] as T[];
  }
  return (raw as T[]) ?? [];
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash: Promise<string> | undefined;
  /** Raw successor pair for a refresh hash, kept only for the grace window. */
  private readonly grace = new Map<string, LoginResult>();

  constructor(
    private readonly signing: SigningKeysService,
    private readonly denylist: Denylist,
  ) {}

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
    const familyId = newFamilyId();
    const access = await issueAccessToken(keys, user, familyId);
    const refreshToken = newRefreshToken();
    const now = Date.now();

    await dataSource.getRepository(RefreshToken).save(
      dataSource.getRepository(RefreshToken).create({
        familyId,
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

  async refresh(refreshToken: string): Promise<LoginResult> {
    const keys = this.signing.material();
    const hash = hashRefreshToken(keys.pepper, refreshToken);
    const rotated = await dataSource.transaction((manager) => this.claimAndRotate(manager, keys, hash));
    if (rotated) {
      this.rememberGrace(hash, rotated);
      return rotated;
    }
    return this.rejectOrReplay(hash);
  }

  async logout(principal: { familyId: string; jti: string; exp: number }): Promise<void> {
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE refresh_tokens
            SET revoked_at = now()
          WHERE family_id = $1
            AND revoked_at IS NULL`,
        [principal.familyId],
      );
    });

    const ttlSec = denyTtlSec(principal.exp);
    if (ttlSec < 1) return;
    try {
      await this.denylist.revoke(principal.jti, ttlSec);
    } catch {
      throw new ApplicationError(
        503,
        "Logout incomplete",
        "The refresh family is revoked, but the access token could not be denylisted. Retry logout.",
        "denylist-unavailable",
      );
    }
  }

  /**
   * One transaction: mark this hash used and insert its successor.
   * A concurrent refresh blocks on the row, then sees zero rows.
   */
  private async claimAndRotate(
    manager: EntityManager,
    keys: SigningMaterial,
    hash: string,
  ): Promise<LoginResult | null> {
    const claimed = statementRows<{
      id: string;
      family_id: string;
      user_id: string;
      absolute_expires_at: Date | string;
    }>(
      await manager.query(
        `UPDATE refresh_tokens
            SET used_at = now()
          WHERE token_hash = $1
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > now()
            AND absolute_expires_at > now()
        RETURNING id, family_id, user_id::text AS user_id, absolute_expires_at`,
        [hash],
      ),
    );
    const row = claimed[0];
    if (!row) return null;

    const users: { id: string; role: string }[] = await manager.query(
      `SELECT id::text AS id, role FROM users WHERE id = $1`,
      [row.user_id],
    );
    const user = users[0];
    if (!user) throw invalidRefresh();

    const next = newRefreshToken();
    const absolute = new Date(row.absolute_expires_at);
    const idleEnd = new Date(Date.now() + REFRESH_IDLE_SEC * 1000);
    await manager.query(
      `INSERT INTO refresh_tokens (family_id, user_id, token_hash, expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.family_id, user.id, hashRefreshToken(keys.pepper, next), idleEnd < absolute ? idleEnd : absolute, absolute],
    );

    const access = await issueAccessToken(keys, user, row.family_id);
    return {
      access_token: access.token,
      refresh_token: next,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SEC,
    };
  }

  private async rejectOrReplay(hash: string): Promise<LoginResult> {
    const rows: StoredRefresh[] = await dataSource.query(
      `SELECT id, family_id, used_at, revoked_at, expires_at, absolute_expires_at
         FROM refresh_tokens WHERE token_hash = $1`,
      [hash],
    );
    const row = rows[0];
    if (!row || row.revoked_at) throw invalidRefresh();

    if (row.used_at) {
      const ageMs = Date.now() - new Date(row.used_at).getTime();
      if (ageMs <= REFRESH_GRACE_MS) {
        const replay = await this.waitForGrace(hash);
        if (replay) return replay;
        throw invalidRefresh();
      }

      const revoked = statementRows<{ id: string }>(
        await dataSource.query(
          `UPDATE refresh_tokens
              SET revoked_at = now()
            WHERE family_id = $1
              AND revoked_at IS NULL
          RETURNING id`,
          [row.family_id],
        ),
      );
      if (revoked.length > 0) {
        console.info(`refresh_reuse_detected family_id=${row.family_id} refresh_id=${row.id}`);
      }
    }

    throw invalidRefresh();
  }

  private rememberGrace(hash: string, pair: LoginResult): void {
    this.grace.set(hash, pair);
    const timer = setTimeout(() => this.grace.delete(hash), REFRESH_GRACE_MS);
    timer.unref();
  }

  private async waitForGrace(hash: string): Promise<LoginResult | undefined> {
    const deadline = Date.now() + Math.min(REFRESH_GRACE_MS, 500);
    for (;;) {
      const pair = this.grace.get(hash);
      if (pair) return pair;
      if (Date.now() > deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private placeholderHash(): Promise<string> {
    this.dummyHash ??= hashPassword("not-a-real-user");
    return this.dummyHash;
  }
}
