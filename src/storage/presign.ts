import { GetObjectCommand, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { readStorageEnv } from "../config/env.schema";
import { createStorageClient } from "./client";

/** Same signer the API uses. Callers choose the lifetime; the avatar route uses 180s. */
export async function presignPut(objectKey: string, contentType: string, expiresIn: number): Promise<string> {
  const env = readStorageEnv();
  return getSignedUrl(
    createStorageClient(env),
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: objectKey,
      ContentType: contentType,
    }),
    { expiresIn },
  );
}

export async function presignUploadPart(
  objectKey: string,
  uploadId: string,
  partNumber: number,
  expiresIn: number,
): Promise<string> {
  const env = readStorageEnv();
  return getSignedUrl(
    createStorageClient(env),
    new UploadPartCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: objectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn },
  );
}

/** Short read link. The guard runs on our route; this URL only carries the bytes. */
export async function presignGet(objectKey: string, expiresIn: number): Promise<string> {
  const env = readStorageEnv();
  return getSignedUrl(
    createStorageClient(env),
    new GetObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: objectKey,
    }),
    { expiresIn },
  );
}
