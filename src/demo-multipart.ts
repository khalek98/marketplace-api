/**
 * demo:multipart — a killed upload is resumed from the parts already stored.
 * Prints key=number. Exit 1 when an invariant does not hold.
 * Run twice: the second pass must still see no object before Complete.
 */
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  NotFound,
} from "@aws-sdk/client-s3";

import {
  call,
  DEMO_PASSWORD,
  line,
  removeDemoUser,
  resetDemoUser,
  startApi,
  stopApi,
  tokenPair,
} from "./auth/demo-harness";
import { readStorageEnv } from "./config/env.schema";
import dataSource from "./data-source";
import { createStorageClient } from "./storage/client";
import { MIN_PART_BYTES } from "./uploads/content-types";

const PORT = 21172;
const EMAIL = "demo-multipart@seed.local";
const FILE = Buffer.alloc(MIN_PART_BYTES * 2 + 1024 * 1024, 7);

const WORKER = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const file = Buffer.concat(chunks);
const plan = JSON.parse(process.env.MPU_PLAN);
for (const part of plan.parts) {
  if (part.part_number > plan.dieAfter) break;
  const start = (part.part_number - 1) * plan.partSize;
  const end = Math.min(file.length, start + plan.partSize);
  const res = await fetch(part.url, { method: "PUT", body: file.subarray(start, end) });
  if (!res.ok) {
    process.stdout.write("FAIL " + res.status + "\\n");
    process.exit(1);
  }
  await new Promise((resolve) => process.stdout.write("PART " + part.part_number + "\\n", () => resolve()));
}
process.kill(process.pid, "SIGKILL");
`;

const RESUMER = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const file = Buffer.concat(chunks);
const headers = { authorization: "Bearer " + process.env.TOKEN };
const planRes = await fetch(process.env.API + "/uploads/" + process.env.FILE_ID + "/parts", { method: "POST", headers });
const plan = await planRes.json();
for (const part of plan.missing ?? []) {
  const start = (part.part_number - 1) * plan.part_size;
  const end = Math.min(file.length, start + plan.part_size);
  const res = await fetch(part.url, { method: "PUT", body: file.subarray(start, end) });
  if (!res.ok) {
    process.stdout.write("FAIL " + res.status + "\\n");
    process.exit(1);
  }
  await new Promise((resolve) => process.stdout.write("REUPLOAD " + part.part_number + "\\n", () => resolve()));
}
const complete = await fetch(process.env.API + "/uploads/" + process.env.FILE_ID + "/complete", { method: "POST", headers });
process.stdout.write("COMPLETE " + complete.status + "\\n");
`;

type IntentResponse = {
  id?: string;
  object_key?: string;
  upload_id?: string;
  part_size?: number;
  parts?: Array<{ part_number: number; url: string }>;
};

async function main(): Promise<void> {
  let api: ChildProcess | undefined;
  const status = {
    "head-before-complete": 0,
    "resumed-parts": 0,
    complete: 0,
    "size-match": 0,
    "etag-multipart": 0,
  };

  const killApi = () => {
    if (api && api.exitCode === null) api.kill("SIGKILL");
  };
  process.on("exit", killApi);

  try {
    await wipeDemo();
    await resetDemoUser(EMAIL);
    api = await startApi(PORT);

    const login = await call(PORT, "/auth/login", {
      method: "POST",
      json: { email: EMAIL, password: DEMO_PASSWORD },
    });
    const token = tokenPair(login.json).access;
    const intent = await postJson(PORT, "/uploads/intent", token, "demo-multipart", {
      content_type: "image/jpeg",
      purpose: "avatar",
      size_bytes: FILE.length,
    });
    const created = intent.json as IntentResponse;

    const killed = await runChild(
      WORKER,
      { MPU_PLAN: JSON.stringify({ dieAfter: 2, partSize: created.part_size, parts: created.parts }) },
      FILE,
    );
    if (!killed.out.includes("PART 1") || !killed.out.includes("PART 2")) {
      throw new Error(`worker did not leave two parts behind:\n${killed.out}`);
    }

    status["head-before-complete"] = created.object_key ? await headStatus(created.object_key) : 0;

    const resumed = await runChild(
      RESUMER,
      { API: `http://127.0.0.1:${PORT}`, TOKEN: token, FILE_ID: created.id ?? "" },
      FILE,
    );
    status["resumed-parts"] = [...resumed.out.matchAll(/REUPLOAD \d+/g)].length;
    status.complete = Number(resumed.out.match(/COMPLETE (\d+)/)?.[1] ?? 0);

    if (created.object_key && status.complete === 200) {
      const head = await headObject(created.object_key);
      status["size-match"] = head?.size === FILE.length ? 1 : 0;
      status["etag-multipart"] = multipartEtag(head?.etag ?? "", FILE) ? 1 : 0;
    }
  } finally {
    for (const [key, value] of Object.entries(status)) line(key, value);
    await stopApi(api);
    await wipeDemo();
    await removeDemoUser(EMAIL);
  }

  const ok =
    status["head-before-complete"] === 404 &&
    status["resumed-parts"] === 1 &&
    status.complete === 200 &&
    status["size-match"] === 1 &&
    status["etag-multipart"] === 1;
  if (!ok) process.exitCode = 1;
}

function multipartEtag(etag: string, body: Buffer): boolean {
  const suffix = etag.match(/-(\d+)"?$/);
  if (!suffix || Number(suffix[1]) !== 3) return false;
  const hash = etag.replace(/"/g, "").replace(/-\d+$/, "");
  return hash !== createHash("md5").update(body).digest("hex");
}

async function postJson(
  port: number,
  path: string,
  token: string,
  idempotencyKey: string,
  json: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(json),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: res.status, json: body };
}

function runChild(
  script: string,
  envExtra: NodeJS.ProcessEnv,
  file: Buffer,
): Promise<{ out: string; signal: NodeJS.Signals | null }> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("STORAGE_") || key.startsWith("AWS")) continue;
    env[key] = value;
  }
  Object.assign(env, envExtra);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => resolve({ out, signal: null }));
    child.on("exit", (_code, signal) => resolve({ out, signal }));
    child.stdin.end(file);
  });
}

async function headStatus(objectKey: string): Promise<number> {
  try {
    await headObject(objectKey);
    return 200;
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey"))
    ) {
      return 404;
    }
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return status ?? 0;
  }
}

async function headObject(objectKey: string): Promise<{ size: number; etag: string } | undefined> {
  const env = readStorageEnv();
  const result = await createStorageClient(env).send(
    new HeadObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: objectKey }),
  );
  return { size: result.ContentLength ?? 0, etag: result.ETag ?? "" };
}

async function wipeDemo(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await abortMultipartUploads();
  const rows: Array<{ id: string }> = await dataSource.query(`SELECT id::text AS id FROM users WHERE email = $1`, [
    EMAIL,
  ]);
  const ownerId = rows[0]?.id;
  if (ownerId) await deletePrefix(`uploads/${ownerId}/`);
  await dataSource.query(`DELETE FROM files WHERE owner_id IN (SELECT id FROM users WHERE email = $1)`, [EMAIL]);
}

async function abortMultipartUploads(): Promise<void> {
  const env = readStorageEnv();
  const client = createStorageClient(env);
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  do {
    const page = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: env.STORAGE_BUCKET,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    );
    for (const upload of page.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId) continue;
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: env.STORAGE_BUCKET,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);
}

async function deletePrefix(prefix: string): Promise<void> {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
