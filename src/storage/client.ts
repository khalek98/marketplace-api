import { S3Client } from "@aws-sdk/client-s3";

import { readStorageEnv, StorageEnv } from "../config/env.schema";

export function createStorageClient(env: StorageEnv = readStorageEnv()): S3Client {
  const endpoint = env.STORAGE_ENDPOINT || undefined;
  return new S3Client({
    region: env.STORAGE_REGION,
    endpoint,
    // Garage (and other emulators) serve /bucket/key. Real AWS uses virtual host.
    forcePathStyle: Boolean(endpoint),
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY,
      secretAccessKey: env.STORAGE_SECRET_KEY,
    },
    // Presign happens before the body exists. The SDK default checksum is then
    // CRC32 of empty bytes and some stores reject the PUT.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}
