import "reflect-metadata";

import dataSource from "./data-source";
import { relayOutboxPass } from "./broker/relay-outbox";

const IDLE_MS = 1000;
const BUSY_MS = 50;

let stop = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the outbox until SIGINT/SIGTERM.
 * Demos still call relayOutboxPass directly so crash-relay can abort mid-pass.
 */
async function main(): Promise<void> {
  process.on("SIGINT", () => {
    stop = true;
  });
  process.on("SIGTERM", () => {
    stop = true;
  });

  await dataSource.initialize();
  console.log("outbox relay listening");

  try {
    while (!stop) {
      let published = 0;
      try {
        published = await relayOutboxPass({ limit: 32 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`outbox relay pass failed: ${message}`);
      }
      await sleep(published > 0 && !stop ? BUSY_MS : IDLE_MS);
    }
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
