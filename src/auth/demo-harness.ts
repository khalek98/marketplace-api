import "reflect-metadata";

import { ChildProcess, spawn } from "node:child_process";

import dataSource from "../data-source";
import { hashPassword } from "./password";

export const DEMO_PASSWORD = "demo-password";

export type HttpResult = { status: number; json: unknown };

export async function resetDemoUser(email: string, role: "buyer" | "seller" | "admin" = "buyer"): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.query(`DELETE FROM users WHERE email = $1`, [email]);
  await dataSource.query(`INSERT INTO users (email, role, password_hash) VALUES ($1, $2, $3)`, [
    email,
    role,
    await hashPassword(DEMO_PASSWORD),
  ]);
}

export async function removeDemoUser(email: string): Promise<void> {
  if (!dataSource.isInitialized) return;
  await dataSource.query(`DELETE FROM users WHERE email = $1`, [email]);
  await dataSource.destroy();
}

/** Start dist/main.js on its own port. Caller must stop it, including on SIGINT. */
export async function startApi(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["dist/main.js"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });

  const kill = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("SIGINT", () => {
    kill();
    process.exit(1);
  });
  process.once("SIGTERM", () => {
    kill();
    process.exit(1);
  });

  const started = Date.now();
  while (!log.includes("listening on")) {
    if (child.exitCode !== null) {
      throw new Error(`API exited ${child.exitCode} before listen\n${log.slice(-2000)}`);
    }
    if (Date.now() - started > 15_000) {
      kill();
      throw new Error(`API did not listen on ${port}\n${log.slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return child;
}

export async function stopApi(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function call(
  port: number,
  path: string,
  opts: { method?: string; token?: string; json?: unknown } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

export function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

export function tokenPair(body: unknown): { access: string; refresh: string } {
  const pair = body as { access_token?: string; refresh_token?: string };
  if (!pair?.access_token || !pair.refresh_token) {
    throw new Error("login response has no token pair");
  }
  return { access: pair.access_token, refresh: pair.refresh_token };
}
