/**
 * demo:upload — bytes reach storage while this API is down.
 * Prints key=number. Exit 1 when an invariant does not hold.
 */
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

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
import { presignPut } from "./storage/presign";

const FIRST_PORT = 21170;
const SECOND_PORT = 21171;
const EMAIL = "demo-upload@seed.local";
const EVIL_NAME = "../../etc/passwd";
const BYTES = Buffer.from("demo-upload");

const CHILD_PUT = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const res = await fetch(process.env.PUT_URL, {
  method: "PUT",
  headers: { "content-type": process.env.PUT_TYPE },
  body: Buffer.concat(chunks),
});
process.stdout.write(String(res.status));
`;

type IntentResponse = {
  id?: string;
  object_key?: string;
  upload?: { url?: string; headers?: { "Content-Type"?: string } };
};

async function main(): Promise<void> {
  let api: ChildProcess | undefined;
  const status = {
    intent: 0,
    "key-from-server": 0,
    "api-alive": 1,
    "put-offline": 0,
    commit: 0,
    "commit-without-bytes": 0,
    tampered: 0,
    expired: 0,
  };

  const killApi = () => {
    if (api && api.exitCode === null) api.kill("SIGKILL");
  };
  process.on("exit", killApi);
  process.on("SIGINT", () => {
    killApi();
    process.exit(1);
  });
  process.on("SIGTERM", () => {
    killApi();
    process.exit(1);
  });

  try {
    await wipeDemoUser();
    await resetDemoUser(EMAIL);
    api = await startApi(FIRST_PORT);

    const login = await call(FIRST_PORT, "/auth/login", {
      method: "POST",
      json: { email: EMAIL, password: DEMO_PASSWORD },
    });
    const token = tokenPair(login.json).access;

    const intent = await postJson(FIRST_PORT, "/uploads/intent", token, `demo-upload-${randomUUID()}`, {
      content_type: "image/jpeg",
      purpose: "avatar",
      filename: EVIL_NAME,
      size_bytes: BYTES.length,
    });
    status.intent = intent.status;
    const created = intent.json as IntentResponse;
    const objectKey = created.object_key ?? "";
    status["key-from-server"] =
      objectKey.length > 0 && !objectKey.includes("passwd") && !objectKey.includes("..") ? 1 : 0;

    await stopApi(api);
    api = undefined;
    status["api-alive"] = (await portOpen(FIRST_PORT)) ? 1 : 0;

    const uploadUrl = created.upload?.url;
    const contentType = created.upload?.headers?.["Content-Type"] ?? "image/jpeg";
    if (uploadUrl) status["put-offline"] = await putWithoutKeys(uploadUrl, contentType, BYTES);

    api = await startApi(SECOND_PORT);
    if (created.id) {
      status.commit = (await postJson(SECOND_PORT, `/uploads/${created.id}/commit`, token)).status;
    }

    const empty = await postJson(SECOND_PORT, "/uploads/intent", token, `demo-upload-empty-${randomUUID()}`, {
      content_type: "image/jpeg",
      purpose: "avatar",
    });
    const emptyBody = empty.json as IntentResponse;
    if (emptyBody.id) {
      status["commit-without-bytes"] = (await postJson(SECOND_PORT, `/uploads/${emptyBody.id}/commit`, token)).status;
    }

    if (uploadUrl) status.tampered = await putWithoutKeys(tamperKey(uploadUrl), contentType, BYTES);

    const shortLived = await presignPut(`uploads/expired-probe/${randomUUID()}.jpg`, "image/jpeg", 2);
    await sleep(3000);
    status.expired = await putWithoutKeys(shortLived, "image/jpeg", BYTES);
  } finally {
    for (const [key, value] of Object.entries(status)) line(key, value);
    await stopApi(api);
    await wipeDemoUser();
    await removeDemoUser(EMAIL);
  }

  const commitWithoutBytes = status["commit-without-bytes"];
  const ok =
    status.intent === 200 &&
    status["key-from-server"] === 1 &&
    status["api-alive"] === 0 &&
    status["put-offline"] === 200 &&
    status.commit === 200 &&
    commitWithoutBytes >= 400 &&
    commitWithoutBytes < 500 &&
    status.tampered === 403 &&
    status.expired === 403;
  if (!ok) process.exitCode = 1;
}

async function postJson(
  port: number,
  path: string,
  token: string,
  idempotencyKey?: string,
  json?: unknown,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (json !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
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

function putWithoutKeys(url: string, contentType: string, body: Buffer): Promise<number> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("STORAGE_") || key.startsWith("AWS")) continue;
    env[key] = value;
  }
  env.PUT_URL = url;
  env.PUT_TYPE = contentType;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD_PUT], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    const finish = (status: number) => resolve(status);
    child.on("error", () => finish(0));
    child.on("exit", () => {
      const status = Number(out.trim());
      finish(Number.isInteger(status) ? status : 0);
    });
    child.stdin.end(body);
  });
}

function tamperKey(url: string): string {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/");
  parts[parts.length - 1] = "tampered.jpg";
  parsed.pathname = parts.join("/");
  return parsed.toString();
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(300);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function wipeDemoUser(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const rows: Array<{ id: string }> = await dataSource.query(`SELECT id::text AS id FROM users WHERE email = $1`, [
    EMAIL,
  ]);
  const ownerId = rows[0]?.id;
  if (ownerId) await deletePrefix(`uploads/${ownerId}/`);
  await dataSource.query(`DELETE FROM files WHERE owner_id IN (SELECT id FROM users WHERE email = $1)`, [EMAIL]);
}

async function deletePrefix(prefix: string): Promise<void> {
  const env = readStorageEnv();
  const client = createStorageClient(env);
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: env.STORAGE_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key) continue;
      await client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: item.Key }));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
