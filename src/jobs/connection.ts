import type { ConnectionOptions } from "bullmq";

import { jobsConnectionFromEnv } from "../redis/clients";

/** Shared BullMQ connection options (jobs Redis, maxRetriesPerRequest: null). */
export function bullmqConnection(): ConnectionOptions {
  return jobsConnectionFromEnv() as ConnectionOptions;
}

export const MARKETPLACE_QUEUE = "marketplace-jobs";
