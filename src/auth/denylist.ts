import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";

import dataSource from "../data-source";

/**
 * Access-token denylist lives in Postgres so logout can write it in the same
 * transaction as the refresh-family revoke. A crash cannot leave the access
 * token usable after the family is already dead.
 */
@Injectable()
export class Denylist {
  async revoke(manager: EntityManager, jti: string, expSec: number): Promise<void> {
    await manager.query(
      `INSERT INTO denied_access_tokens (jti, expires_at)
       VALUES ($1, to_timestamp($2))
       ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [jti, expSec],
    );
  }

  async has(jti: string): Promise<boolean> {
    if (!dataSource.isInitialized) await dataSource.initialize();
    const rows: unknown[] = await dataSource.query(
      `SELECT 1 FROM denied_access_tokens WHERE jti = $1 AND expires_at > now()`,
      [jti],
    );
    return rows.length > 0;
  }
}
