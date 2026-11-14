import { PutObjectCommand } from "@aws-sdk/client-s3";
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
