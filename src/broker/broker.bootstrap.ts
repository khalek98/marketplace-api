import { Injectable, OnModuleInit } from "@nestjs/common";

import { isBrokerEnabled } from "./broker-enabled";
import { withChannel } from "./connect";
import { declareTopology } from "./topology";

/** Declares exchanges/queues on API start. Publisher never asserts consumer queues. */
@Injectable()
export class BrokerBootstrap implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    if (!isBrokerEnabled()) return;
    await withChannel(async (ch) => {
      await declareTopology(ch);
    });
  }
}
