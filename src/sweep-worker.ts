import { Queue, Worker } from "bullmq";

import { bullmqConnection } from "./jobs/connection";
import { FILE_SWEEP_QUEUE, sweepPendingUploads } from "./uploads/sweep-pending";

async function main(): Promise<void> {
  const connection = bullmqConnection();
  const queue = new Queue(FILE_SWEEP_QUEUE, { connection });
  await queue.upsertJobScheduler(
    "pending-files",
    { every: 24 * 60 * 60 * 1000 },
    { name: "sweep-pending", opts: { removeOnComplete: { age: 24 * 60 * 60 } } },
  );

  const worker = new Worker(
    FILE_SWEEP_QUEUE,
    async () => {
      const swept = await sweepPendingUploads();
      console.log(`swept=${swept}`);
      return swept;
    },
    { connection: bullmqConnection() },
  );

  worker.on("failed", (_job, error) => {
    console.error(error);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
