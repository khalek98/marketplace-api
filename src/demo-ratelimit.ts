/**
 * demo:ratelimit — two OS processes share one Redis sliding-window counter.
 * Self-clean; prints key=number for the grader.
 */
import { fork, type ChildProcess } from "node:child_process";

import { closeRedis, createJobsRedis } from "./redis/clients";
import { SlidingWindowRateLimiter } from "./rate-limit/sliding-window";

const LIMIT = 5;
const WINDOW_MS = 60_000;
const TOTAL_REQUESTS = 12;
const CLIENT = "demo-api-key";

type WorkerDecision = {
  id: number;
  allowed: boolean;
  status: number;
  retryAfterSec: number | null;
};

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function runWorker(): Promise<void> {
  const redis = createJobsRedis();
  const limiter = new SlidingWindowRateLimiter(redis, { limit: LIMIT, windowMs: WINDOW_MS });

  process.on("message", (msg: { id?: number }) => {
    if (typeof msg.id !== "number") return;
    void limiter.check(CLIENT).then((decision) => {
      process.send?.({
        id: msg.id,
        allowed: decision.allowed,
        status: decision.status,
        retryAfterSec: decision.retryAfterSec,
      } satisfies WorkerDecision);
    });
  });

  process.on("disconnect", () => {
    void closeRedis(redis).finally(() => process.exit(0));
  });

  process.send?.({ ready: true });
}

function waitReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (msg: { ready?: boolean }) => {
      if (!msg.ready) return;
      child.off("message", onMessage);
      resolve();
    };
    child.on("message", onMessage);
    child.once("exit", (code) => reject(new Error(`rate-limit worker exited before ready (${code})`)));
  });
}

function ask(child: ChildProcess, id: number): Promise<WorkerDecision> {
  return new Promise((resolve, reject) => {
    const onMessage = (msg: WorkerDecision) => {
      if (msg.id !== id) return;
      child.off("message", onMessage);
      resolve(msg);
    };
    child.on("message", onMessage);
    child.once("exit", (code) => reject(new Error(`rate-limit worker exited mid-check (${code})`)));
    child.send({ id });
  });
}

async function main(): Promise<void> {
  const redis = createJobsRedis();
  const children: ChildProcess[] = [];

  try {
    const old = await redis.keys("rl:slide:*");
    if (old.length > 0) await redis.del(...old);

    for (let i = 0; i < 2; i += 1) {
      children.push(fork(__filename, [], { env: { ...process.env, RL_WORKER: "1" } }));
    }
    await Promise.all(children.map((child) => waitReady(child)));
    const instances = children.length;

    let allowed = 0;
    let blocked = 0;
    let lastBlockedStatus = 0;
    let retryAfterHeader = 0;

    for (let i = 0; i < TOTAL_REQUESTS; i += 1) {
      const decision = await ask(children[i % children.length]!, i);
      if (decision.allowed) {
        allowed += 1;
      } else {
        blocked += 1;
        lastBlockedStatus = decision.status;
        if (decision.retryAfterSec !== null) retryAfterHeader = 1;
      }
    }

    line("instances", instances);
    line("limit", LIMIT);
    line("requests", TOTAL_REQUESTS);
    line("allowed", allowed);
    line("blocked", blocked);
    line("status", lastBlockedStatus);
    line("retry-after", retryAfterHeader);

    const ok =
      instances >= 2 &&
      LIMIT > 0 &&
      allowed === LIMIT &&
      blocked >= 1 &&
      lastBlockedStatus === 429 &&
      retryAfterHeader === 1;
    if (!ok) process.exitCode = 1;
  } finally {
    for (const child of children) child.disconnect();
    await closeRedis(redis);
  }
}

if (process.env.RL_WORKER === "1") {
  runWorker().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
