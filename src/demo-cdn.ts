/**
 * demo:cdn — the bucket is private, the edge caches, and a new file gets a new name.
 * Prints key=number. Exit 1 when an invariant does not hold.
 */
import http from "node:http";

import { assetKey, deletePrefix, publishAsset } from "./storage/publish";
import { readStorageEnv } from "./config/env.schema";
import { resetEdgeCache, startEdge } from "./edge";
import { line } from "./auth/demo-harness";

const PORT = 21162;
const RED = Buffer.from("body{color:red}");
const GREEN = Buffer.from("body{color:green}");

async function main(): Promise<void> {
  let server: http.Server | undefined;
  const status = {
    direct: 0,
    "edge-miss": 0,
    "edge-hit": 0,
    "cache-hit": 0,
    "new-name": 0,
    "new-url": 0,
    "content-changed": 0,
  };

  try {
    await deletePrefix("assets/");
    resetEdgeCache();
    server = await startEdge(PORT);

    const firstKey = assetKey("app", RED, "css");
    const secondKey = assetKey("app", GREEN, "css");
    await publishAsset(firstKey, RED, "text/css");

    status.direct = await storageStatus(firstKey);
    const miss = await edgeGet(firstKey);
    status["edge-miss"] = miss.status;
    const hit = await edgeGet(firstKey);
    status["edge-hit"] = hit.status;
    status["cache-hit"] = hit.cache === "HIT" ? 1 : 0;

    await publishAsset(secondKey, GREEN, "text/css");
    status["new-name"] = firstKey !== secondKey ? 1 : 0;
    const next = await edgeGet(secondKey);
    status["new-url"] = next.status;
    status["content-changed"] = !next.body.equals(RED) && next.body.equals(GREEN) ? 1 : 0;
  } finally {
    for (const [key, value] of Object.entries(status)) line(key, value);
    await closeServer(server);
    resetEdgeCache();
    await deletePrefix("assets/");
  }

  const ok =
    status.direct === 403 &&
    status["edge-miss"] === 200 &&
    status["edge-hit"] === 200 &&
    status["cache-hit"] === 1 &&
    status["new-name"] === 1 &&
    status["new-url"] === 200 &&
    status["content-changed"] === 1;
  if (!ok) process.exitCode = 1;
}

async function storageStatus(key: string): Promise<number> {
  const env = readStorageEnv();
  const root = env.STORAGE_ENDPOINT.replace(/\/$/, "");
  const res = await fetch(`${root}/${env.STORAGE_BUCKET}/${key}`);
  await res.arrayBuffer();
  return res.status;
}

async function edgeGet(key: string): Promise<{ status: number; cache: string; body: Buffer }> {
  const res = await fetch(`http://127.0.0.1:${PORT}/${key}`);
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, cache: res.headers.get("x-cache") ?? "", body };
}

function closeServer(server: http.Server | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
