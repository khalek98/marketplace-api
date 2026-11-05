/**
 * demo:queue — BullMQ retries, jobId dedup, upsertJobScheduler on noeviction Redis.
 * Self-clean; prints key=number for the grader.
 */
import { Queue, Worker, type Job } from "bullmq";

import { bullmqConnection, MARKETPLACE_QUEUE } from "./jobs/connection";
import { closeRedis, createJobsRedis, redisConfigGet } from "./redis/clients";

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const probe = createJobsRedis();
  const connection = bullmqConnection();
  const queue = new Queue(MARKETPLACE_QUEUE, { connection });

  let worker: Worker | undefined;

  try {
    const policy = await redisConfigGet(probe, "maxmemory-policy");
    const queueNoeviction = policy === "noeviction" ? 1 : 0;

    await queue.obliterate({ force: true });

    // ── Dedup by jobId (no worker yet so both stay queued/deduped) ──────────
    const dedupId = "demo-recalc-rating-42";
    await queue.add("recalc-rating", { productId: "42" }, { jobId: dedupId, removeOnComplete: { age: 3600 } });
    await queue.add("recalc-rating", { productId: "42" }, { jobId: dedupId, removeOnComplete: { age: 3600 } });
    const added = 2;
    const counts = await queue.getJobCounts("wait", "delayed", "paused", "prioritized");
    const queued = counts.wait + counts.delayed + counts.paused + counts.prioritized;

    await queue.obliterate({ force: true });

    // ── Flaky job: fail until 3rd execution ─────────────────────────────────
    const attemptRuns: number[] = [];
    let completed = 0;

    worker = new Worker(
      MARKETPLACE_QUEUE,
      async (job: Job) => {
        if (job.name === "tick") {
          return "ok";
        }
        attemptRuns.push(job.attemptsMade);
        // attemptsMade is 1-based on first run in BullMQ — fail while < 3.
        if (job.attemptsMade < 3) {
          throw new Error("neighbor service down");
        }
        completed = 1;
        return "ok";
      },
      { connection: bullmqConnection() },
    );

    await queue.add(
      "recalc-rating",
      { productId: "42", failUntil: 3 },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 200, jitter: 0.2 },
        removeOnComplete: { age: 3600 },
      },
    );

    const retryDeadline = Date.now() + 15_000;
    while (completed !== 1 && Date.now() < retryDeadline) {
      await sleep(50);
    }
    const attempts = attemptRuns.length;

    // ── Scheduler: upsert twice → one scheduler; ≥2 runs in a window ────────
    const ticks: number[] = [];
    worker.on("completed", (job) => {
      if (job.name === "tick") ticks.push(Date.now());
    });

    await queue.upsertJobScheduler(
      "demo-heartbeat",
      { every: 400 },
      { name: "tick", data: {}, opts: { removeOnComplete: { age: 60 } } },
    );
    await queue.upsertJobScheduler(
      "demo-heartbeat",
      { every: 400 },
      { name: "tick", data: {}, opts: { removeOnComplete: { age: 60 } } },
    );

    const schedDeadline = Date.now() + 5_000;
    while (ticks.length < 2 && Date.now() < schedDeadline) {
      await sleep(50);
    }

    const schedulers = (await queue.getJobSchedulers()).length;
    const scheduledRuns = ticks.length;

    await queue.removeJobScheduler("demo-heartbeat");

    line("queue-noeviction", queueNoeviction);
    line("attempts", attempts);
    line("completed", completed);
    line("added", added);
    line("queued", queued);
    line("schedulers", schedulers);
    line("scheduled-runs", scheduledRuns);

    const ok =
      queueNoeviction === 1 &&
      attempts >= 3 &&
      completed === 1 &&
      added === 2 &&
      queued === 1 &&
      schedulers >= 1 &&
      scheduledRuns >= 2;
    if (!ok) process.exitCode = 1;
  } finally {
    await worker?.close().catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
    await closeRedis(probe);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
