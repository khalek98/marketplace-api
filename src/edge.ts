import http from "node:http";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import { readStorageEnv } from "./config/env.schema";
import { createStorageClient } from "./storage/client";

type Cached = { body: Buffer; headers: Record<string, string | number> };

const cache = new Map<string, Cached>();

export function resetEdgeCache(): void {
  cache.clear();
}

/** Local stand-in for a CDN edge: the cache fetches the private bucket, the public does not. */
export function startEdge(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void serve(keyOf(req), res).catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function keyOf(req: http.IncomingMessage): string {
  return decodeURIComponent((req.url ?? "/").replace(/^\//, ""));
}

async function serve(key: string, res: http.ServerResponse): Promise<void> {
  // Private uploads stay behind GET /files/:id. Edge only serves published assets.
  if (!key.startsWith("assets/") || key.includes("..")) {
    res.writeHead(404);
    res.end();
    return;
  }

  const hit = cache.get(key);
  if (hit) {
    res.writeHead(200, { ...hit.headers, "x-cache": "HIT" });
    res.end(hit.body);
    return;
  }

  const env = readStorageEnv();
  const result = await createStorageClient(env).send(new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }));
  const body = Buffer.from(await result.Body!.transformToByteArray());
  const cacheControl = result.CacheControl ?? "";
  const headers: Record<string, string | number> = {
    "content-type": result.ContentType ?? "application/octet-stream",
    "content-length": body.length,
    "x-cache": "MISS",
  };
  if (cacheControl) headers["cache-control"] = cacheControl;
  if (/\bpublic\b/.test(cacheControl) && /max-age=\d+/.test(cacheControl)) {
    cache.set(key, { body, headers });
  }
  res.writeHead(200, headers);
  res.end(body);
}
