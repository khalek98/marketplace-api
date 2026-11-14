/**
 * demo:sweep — a pending upload older than a day is aborted and removed.
 * The row is backdated so the demo does not wait 24 hours.
 * Prints key=number. Exit 1 when an invariant does not hold.
 */
import { ChildProcess } from "node:child_process";

import { ListMultipartUploadsCommand } from "@aws-sdk/client-s3";
import { Queue, Worker } from "bullmq";

import { call, DEMO_PASSWORD, line, removeDemoUser, resetDemoUser, startApi, stopApi, tokenPair } from "./auth/demo-harness";
import { readStorageEnv } from "./config/env.schema";
import dataSource from "./data-source";
import { bullmqConnection } from "./jobs/connection";
import { createStorageClient } from "./storage/client";
import { FILE_SWEEP_QUEUE, sweepPendingUploads } from "./uploads/sweep-pending";

const PORT = 21174;
const EMAIL = "demo-sweep@seed.local";
const OLD_BYTES = 9 * 1024 * 1024;

type IntentResponse = { id?: string; upload_id?: string };

async function main(): Promise<void> {
  let api: ChildProcess | undefined;
  const status = { swept: 0, "old-gone": 0, "fresh-kept": 0, "upload-aborted": 0 };
  const queue = new Queue(FILE_SWEEP_QUEUE, { connection: bullmqConnection() });
  let worker: Worker | undefined;

  try {
    await queue.obliterate({ force: true });
    if (!dataSource.isInitialized) await dataSource.initialize();
    await dataSource.query(`DELETE FROM files WHERE owner_id IN (SELECT id FROM users WHERE email = $1)`, [EMAIL]);
    await resetDemoUser(EMAIL);
    api = await startApi(PORT);

    const login = await call(PORT, "/auth/login", {
      method: "POST",
      json: { email: EMAIL, password: DEMO_PASSWORD },
    });
    const token = tokenPair(login.json).access;
    const old = (await postIntent(token, "sweep-old", OLD_BYTES)).json as IntentResponse;
    await dataSource.query(`UPDATE files SET created_at = now() - interval '2 days' WHERE id = $1`, [old.id]);
    const fresh = (await postIntent(token, "sweep-fresh", 32)).json as IntentResponse;

    let finished = false;
    worker = new Worker(
      FILE_SWEEP_QUEUE,
      async () => {
        status.swept = await sweepPendingUploads();
        finished = true;
        return status.swept;
      },
      { connection: bullmqConnection() },
    );
    await queue.add("sweep-pending", {}, { removeOnComplete: true });
    const deadline = Date.now() + 10_000;
    while (!finished && Date.now() < deadline) await sleep(50);

    const oldRow = await dataSource.query(`SELECT id FROM files WHERE id = $1`, [old.id]);
    const freshRow = await dataSource.query(`SELECT status FROM files WHERE id = $1`, [fresh.id]);
    status["old-gone"] = oldRow.length === 0 ? 1 : 0;
    status["fresh-kept"] = freshRow[0]?.status === "pending" ? 1 : 0;
    status["upload-aborted"] = old.upload_id && !(await uploadStillOpen(old.upload_id)) ? 1 : 0;
  } finally {
    for (const [key, value] of Object.entries(status)) line(key, value);
    await worker?.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await stopApi(api);
    if (!dataSource.isInitialized) await dataSource.initialize();
    await dataSource.query(`DELETE FROM files WHERE owner_id IN (SELECT id FROM users WHERE email = $1)`, [EMAIL]);
    await dataSource.destroy();
    await resetDemoUser(EMAIL);
    await removeDemoUser(EMAIL);
  }

  const ok = status.swept === 1 && status["old-gone"] === 1 && status["fresh-kept"] === 1 && status["upload-aborted"] === 1;
  if (!ok) process.exitCode = 1;
}

async function postIntent(token: string, key: string, size: number): Promise<{ json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${PORT}/uploads/intent`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ content_type: "image/jpeg", purpose: "avatar", size_bytes: size }),
  });
  return { json: await res.json() };
}

async function uploadStillOpen(uploadId: string): Promise<boolean> {
  const env = readStorageEnv();
  const page = await createStorageClient(env).send(new ListMultipartUploadsCommand({ Bucket: env.STORAGE_BUCKET }));
  return (page.Uploads ?? []).some((upload) => upload.UploadId === uploadId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
