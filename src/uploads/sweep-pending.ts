import { AbortMultipartUploadCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { readStorageEnv } from "../config/env.schema";
import dataSource from "../data-source";
import { createStorageClient } from "../storage/client";

/** Pending rows older than this are orphans: abort the upload, delete the object, drop the row. */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const FILE_SWEEP_QUEUE = "file-sweep";

type PendingRow = { id: string; object_key: string; upload_id: string | null };

export async function sweepPendingUploads(now = new Date()): Promise<number> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS);
  const rows: PendingRow[] = await dataSource.query(
    `SELECT id::text AS id, object_key, upload_id
     FROM files
     WHERE status = 'pending' AND created_at < $1`,
    [cutoff],
  );

  const env = readStorageEnv();
  const client = createStorageClient(env);
  for (const row of rows) {
    if (row.upload_id) {
      await client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: env.STORAGE_BUCKET,
            Key: row.object_key,
            UploadId: row.upload_id,
          }),
        )
        .catch((error: unknown) => {
          if (!isAlreadyGone(error)) throw error;
        });
    }
    await client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: row.object_key }));
    await dataSource.query(`DELETE FROM files WHERE id = $1 AND status = 'pending'`, [row.id]);
  }
  return rows.length;
}

function isAlreadyGone(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "NoSuchUpload" || name === "NotFound" || name === "NoSuchKey";
}
