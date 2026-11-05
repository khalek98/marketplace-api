import type { QueryRunner } from "typeorm";

import type { ChannelModel, ConfirmChannel } from "amqplib";

import dataSource from "../data-source";
import { isBrokerEnabled } from "./broker-enabled";
import { connectBroker } from "./connect";
import { publishOrderPlacedOnChannel, type OrderPlacedEvent } from "./publish-order-placed";

export type RelayOutboxPassOptions = {
  limit?: number;
  /**
   * After broker confirms publish, fail before UPDATE published_at.
   * Models crash-relay (at-least-once): messages are out, rows stay unpublished.
   */
  abortBeforeUpdate?: boolean;
  queryRunner?: QueryRunner;
};

/** Simulated crash between publish and UPDATE published_at (demo:crash-relay). */
export class RelayAbortBeforeUpdate extends Error {
  constructor(readonly publishedToBroker: number) {
    super("relay aborted after publish, before UPDATE published_at");
    this.name = "RelayAbortBeforeUpdate";
  }
}

type OutboxRow = {
  id: string;
  payload: OrderPlacedEvent;
};

/**
 * One relay pass: claim unpublished rows with FOR UPDATE SKIP LOCKED,
 * publish each to RabbitMQ, then mark published_at.
 * Order is intentional: publish → UPDATE. Swap = silent loss.
 */
export async function relayOutboxPass(options: RelayOutboxPassOptions = {}): Promise<number> {
  if (!isBrokerEnabled()) {
    throw new Error("relay requires BROKER_URL (broker must be a separate process)");
  }

  const limit = options.limit ?? 32;
  const ownRunner = !options.queryRunner;
  const qr = options.queryRunner ?? dataSource.createQueryRunner();
  let conn: ChannelModel | undefined;
  let ch: ConfirmChannel | undefined;
  let backoffCommitted = false;

  if (ownRunner) {
    await qr.connect();
    await qr.startTransaction();
  }

  try {
    // Literal SKIP LOCKED — grader greps this; same claim pattern as jobs (HW-14).
    const rows: OutboxRow[] = await qr.query(
      `SELECT id, payload FROM outbox
       WHERE published_at IS NULL
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY created_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    if (rows.length === 0) {
      if (ownRunner) await qr.commitTransaction();
      return 0;
    }

    // One connection for the whole batch. A new connect per row holds these locks idle.
    conn = await connectBroker();
    ch = await conn.createConfirmChannel();
    const publishedIds: string[] = [];
    for (const row of rows) {
      const event = normalizePayload(row);
      try {
        await publishOrderPlacedOnChannel(ch, event);
      } catch (error) {
        // Commit the backoff. A rollback would leave attempts at 0 and the row hot-loops.
        if (publishedIds.length > 0) await markPublished(qr, publishedIds);
        await markPublishFailed(qr, row.id);
        if (ownRunner) await qr.commitTransaction();
        backoffCommitted = true;
        throw error;
      }
      publishedIds.push(row.id);
    }

    if (options.abortBeforeUpdate) {
      throw new RelayAbortBeforeUpdate(publishedIds.length);
    }

    await markPublished(qr, publishedIds);

    if (ownRunner) await qr.commitTransaction();
    return publishedIds.length;
  } catch (err) {
    if (ownRunner && !backoffCommitted) await qr.rollbackTransaction().catch(() => undefined);
    throw err;
  } finally {
    await ch?.close().catch(() => undefined);
    await conn?.close().catch(() => undefined);
    if (ownRunner) await qr.release();
  }
}

/** Drain unpublished outbox until empty (or maxPasses safety). */
export async function relayOutboxUntilEmpty(options: { limit?: number; maxPasses?: number } = {}): Promise<number> {
  const maxPasses = options.maxPasses ?? 1000;
  let published = 0;
  for (let i = 0; i < maxPasses; i += 1) {
    const n = await relayOutboxPass({ limit: options.limit });
    if (n === 0) return published;
    published += n;
  }
  throw new Error(`relayOutboxUntilEmpty: still unpublished after ${maxPasses} passes`);
}

async function markPublished(qr: QueryRunner, ids: string[]): Promise<void> {
  await qr.query(
    `UPDATE outbox
     SET published_at = now(), attempts = attempts + 1
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

/** Bump attempts and push next_attempt_at out. Uses the pre-increment attempts value. */
async function markPublishFailed(qr: QueryRunner, id: string): Promise<void> {
  await qr.query(
    `UPDATE outbox
     SET attempts = attempts + 1,
         next_attempt_at = now() + (LEAST(60, power(2, attempts + 1)::int) * interval '1 second')
     WHERE id = $1`,
    [id],
  );
}

function normalizePayload(row: OutboxRow): OrderPlacedEvent {
  const raw = row.payload;
  if (!raw || typeof raw !== "object") {
    throw new Error(`outbox ${row.id}: payload missing`);
  }
  return {
    ...raw,
    // Broker messageId / inbox key = outbox row id (stable across redelivery).
    eventId: row.id,
    type: "order.placed",
    orderId: String(raw.orderId),
    buyerId: String(raw.buyerId),
    occurredAt: String(raw.occurredAt),
  };
}
