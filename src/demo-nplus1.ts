// HW-13 N+1 demo: count real SQL (QueryCountLogger), show naive vs JOIN vs query-strategy.
// Graph: order → items → product (two relation levels).
import "reflect-metadata";

import { AbstractLogger, LogLevel, LogMessage } from "typeorm";

import dataSource from "./data-source";
import { Order } from "./entities/order.entity";
import { OrderItem } from "./entities/order-item.entity";

class QueryCountLogger extends AbstractLogger {
  count = 0;
  echo = false;

  reset() {
    this.count = 0;
  }

  protected writeLog(_level: LogLevel, messages: LogMessage | LogMessage[]) {
    for (const m of Array.isArray(messages) ? messages : [messages]) {
      if (m.type === "query") {
        this.count += 1;
        if (this.echo) {
          console.log(`  SQL#${this.count}: ${String(m.message).slice(0, 120)}`);
        }
      }
    }
  }
}

const logger = new QueryCountLogger(["query"]);

async function main() {
  dataSource.setOptions({ logger });
  await dataSource.initialize();

  const orderRepo = dataSource.getRepository(Order);
  const itemRepo = dataSource.getRepository(OrderItem);

  console.log("── Наївно: find(orders) + find(items) у циклі ──");
  logger.echo = true;
  logger.reset();
  const orders = await orderRepo.find();
  for (const order of orders) {
    const items = await itemRepo.find({ where: { order: { id: order.id } } });
    void items.length;
  }
  const naiveCount = logger.count;
  console.log(`Разом запитів: ${naiveCount} (1 список + ${orders.length} у циклі)\n`);

  console.log("── Фікс №1: relations { items: { product: true } } → JOIN ──");
  logger.reset();
  const withJoin = await orderRepo.find({
    relations: { items: { product: true } },
  });
  const relationsCount = logger.count;
  console.log(`Разом запитів: ${relationsCount}, замовлень: ${withJoin.length}\n`);

  console.log("── Фікс №2: leftJoinAndSelect items + product ──");
  logger.reset();
  const qb = await orderRepo
    .createQueryBuilder("o")
    .leftJoinAndSelect("o.items", "item")
    .leftJoinAndSelect("item.product", "product")
    .getMany();
  const qbCount = logger.count;
  console.log(`Разом запитів: ${qbCount}, замовлень: ${qb.length}\n`);

  console.log('── Фікс №3: relationLoadStrategy: "query" (два рівні → константа 5) ──');
  logger.reset();
  const batched = await orderRepo.find({
    relations: { items: { product: true } },
    relationLoadStrategy: "query",
  });
  const queryStrategyCount = logger.count;
  console.log(`Разом запитів: ${queryStrategyCount}, замовлень: ${batched.length}\n`);

  logger.echo = false;
  console.log("── Підсумок (занеси в README) ──");
  console.log(`| Стратегія                         | Запитів |`);
  console.log(`| --------------------------------- | ------- |`);
  console.log(`| наївно (запит у циклі)            | ${naiveCount} |`);
  console.log(`| relations / leftJoinAndSelect     | ${relationsCount} / ${qbCount} |`);
  console.log(`| relationLoadStrategy: 'query'     | ${queryStrategyCount} |`);
  console.log(
    `\nГоловне: ${naiveCount} росте з N; ${relationsCount} і ${queryStrategyCount} — константи (не залежать від розміру вибірки).`,
  );

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
