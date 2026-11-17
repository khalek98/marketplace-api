/**
 * Thin process for kind / demo:rollout — same probe + SIGTERM contract as Nest,
 * without Postgres/Redis. Env: PORT, WARMUP_MS, DRAIN_MS, GRACEFUL (default 1).
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 4000);
const DRAIN_MS = Number(process.env.DRAIN_MS ?? 5000);
const GRACEFUL = process.env.GRACEFUL !== "0";

let ready = false;
let shuttingDown = false;

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";

  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ alive: true, pid: process.pid }));
    return;
  }

  if (url === "/readyz") {
    if (!ready) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ready: false, shuttingDown }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ready: true }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      service: "cluster-app",
      pid: process.pid,
      ready,
      uid: process.getuid?.() ?? -1,
    }),
  );
});

async function main(): Promise<void> {
  if (WARMUP_MS > 0) {
    console.log(`[warmup] ${WARMUP_MS} ms — listener not open yet`);
    await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
  }

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, "0.0.0.0", () => resolve());
    server.once("error", reject);
  });
  ready = true;
  console.log(`[up] :${PORT} pid=${process.pid} graceful=${GRACEFUL ? "yes" : "no"} drain=${DRAIN_MS}ms`);
}

if (GRACEFUL) {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      ready = false;
      console.log(`[${sig}] ready=false, drain ${DRAIN_MS} ms`);
      setTimeout(() => {
        server.close(() => {
          console.log("[bye] socket closed, exit 0");
          process.exit(0);
        });
      }, DRAIN_MS);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
