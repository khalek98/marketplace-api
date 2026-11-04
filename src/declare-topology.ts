import { withChannel } from "./broker/connect";
import { EXCHANGE, PREFETCH, QUEUE, ROUTING_KEY } from "./broker/names";
import { declareTopology } from "./broker/topology";

async function main(): Promise<void> {
  await withChannel(async (ch) => {
    await declareTopology(ch);
  });

  console.log(`exchange=${EXCHANGE.events}`);
  console.log(`queue=${QUEUE.orderPlaced}`);
  console.log(`dlq=${QUEUE.orderPlacedDlq}`);
  console.log(`binding=${ROUTING_KEY.orderPlaced}`);
  console.log(`prefetch=${PREFETCH}`);
  console.log("topology=ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
