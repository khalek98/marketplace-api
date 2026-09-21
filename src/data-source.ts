// TypeORM CLI entry: typeorm -d dist/data-source.js …
// Credentials only from process.env (Infisical / SKIP_VAULT grader exports).
import "reflect-metadata";
import { DataSource } from "typeorm";

function postgresOptionsFromEnv(): {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
} {
  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      // TypeORM expects `username`; pg driver uses `user` — do not mix them up.
      username: process.env.DB_USER ?? "",
      password: process.env.DB_PASSWORD ?? "",
      database: process.env.DB_NAME ?? "",
    };
  }

  // Local / vault may still inject DB_URL from HW-11.
  const dbUrl = process.env.DB_URL;
  if (dbUrl) {
    const u = new URL(dbUrl);
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      username: process.env.DB_USER || u.username || "",
      password: process.env.DB_PASSWORD || decodeURIComponent(u.password || ""),
      database: u.pathname.replace(/^\//, ""),
    };
  }

  throw new Error("TypeORM DataSource: set DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME (or DB_URL)");
}

export default new DataSource({
  type: "postgres",
  ...postgresOptionsFromEnv(),
  entities: ["dist/entities/**/*.js"],
  migrations: ["dist/migrations/*.js"],
  synchronize: false,
});
