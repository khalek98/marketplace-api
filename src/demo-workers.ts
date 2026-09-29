import "reflect-metadata";

import dataSource from "./data-source";
import { Job } from "./entities/job.entity";

const JOBS = 12;
const WORKERS = 4;
const WORK_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function seedJobs(): Promise<void> {
  await dataSource.query(`DELETE FROM jobs`);
  for (let i = 1; i <= JOBS; i += 1) {
    await dataSource.getRepository(Job).save(
      dataSource.getRepository(Job).create({
        payload: { type: "demo", n: i },
        status: "new",
        worker: null,
        processed: 0,
      }),
    );
  }
}

async function claimOne(worker: string): Promise<"done" | "empty"> {
  return dataSource.transaction(async (manager) => {
    const job = await manager
      .getRepository(Job)
      .createQueryBuilder("job")
      .where("job.status = :status", { status: "new" })
      .orderBy("job.id", "ASC")
      .setLock("pessimistic_write")
      .setOnLocked("skip_locked")
      .limit(1)
      .getOne();

    if (!job) return "empty";

    await sleep(WORK_MS);

    job.status = "done";
    job.worker = worker;
    job.processed += 1;
    await manager.save(job);
    return "done";
  });
}

async function main() {
  await dataSource.initialize();
  await seedJobs();

  const sequentialBound = JOBS * WORK_MS;
  console.log(`${JOBS} задач по ${WORK_MS} мс, ${WORKERS} воркери`);
  console.log(`послідовний bound: ${sequentialBound} мс · ідеал ≈ ${(JOBS / WORKERS) * WORK_MS} мс`);

  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => `w${i + 1}`).map(async (w) => {
      for (;;) {
        const res = await claimOne(w);
        if (res === "empty") {
          const left = await dataSource
            .getRepository(Job)
            .createQueryBuilder("j")
            .where("j.status = :status", { status: "new" })
            .getCount();
          if (left === 0) return;
          await sleep(20);
        }
      }
    }),
  );
  const elapsed = Date.now() - t0;

  const stats = await dataSource.query<{ worker: string; n: string }[]>(
    `SELECT worker, count(*)::text AS n FROM jobs GROUP BY worker ORDER BY worker`,
  );
  const twice = await dataSource.query<{ n: string }[]>(`SELECT count(*)::text AS n FROM jobs WHERE processed <> 1`);
  const twiceN = Number(twice[0]?.n ?? -1);

  const dist = stats.map((r) => `${r.worker}=${r.n}`).join(" ");
  console.log(`час: ${elapsed} мс · розподіл: ${dist}`);
  console.log(`оброблено двічі: ${twiceN}`);

  const workersUsed = new Set(stats.map((r) => r.worker).filter(Boolean)).size;
  const ok = twiceN === 0 && workersUsed >= 2 && elapsed < sequentialBound;

  await dataSource.destroy();

  if (!ok) {
    console.error(
      `інваріант зламано: twice=${twiceN}, workers=${workersUsed}, elapsed=${elapsed} vs bound=${sequentialBound}`,
    );
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
