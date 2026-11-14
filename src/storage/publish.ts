import { createHash } from "node:crypto";

import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

import { readStorageEnv } from "../config/env.schema";
import { createStorageClient } from "./client";

/** Set on the object. Without it the edge has nothing it is allowed to store. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function assetKey(name: string, body: Buffer, ext: string): string {
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 8);
  return `assets/${name}.${hash}.${ext}`;
}

export async function publishAsset(key: string, body: Buffer, contentType: string): Promise<void> {
  const env = readStorageEnv();
  await createStorageClient(env).send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );
}

export async function deletePrefix(prefix: string): Promise<void> {
  const env = readStorageEnv();
  const client = createStorageClient(env);
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: env.STORAGE_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key) continue;
      await client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: item.Key }));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
