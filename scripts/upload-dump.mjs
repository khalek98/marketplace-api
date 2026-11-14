import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const file = process.argv[2];
const endpoint = process.env.STORAGE_ENDPOINT || undefined;
const bucket = process.env.STORAGE_BUCKET;
if (!file || !bucket || !process.env.STORAGE_REGION || !process.env.STORAGE_ACCESS_KEY || !process.env.STORAGE_SECRET_KEY) {
  console.error("usage: node scripts/upload-dump.mjs <file>  (needs STORAGE_BUCKET, STORAGE_REGION, and the key pair)");
  process.exit(1);
}

const client = new S3Client({
  region: process.env.STORAGE_REGION,
  endpoint,
  forcePathStyle: Boolean(endpoint),
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const key = `dumps/${basename(file)}`;
await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: await readFile(file),
    ContentType: "application/octet-stream",
  }),
);
console.log(key);
