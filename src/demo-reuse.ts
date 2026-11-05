/**
 * demo:reuse — a refresh used again after the grace window revokes the whole family.
 * The pause is longer than REFRESH_GRACE_MS, otherwise the second use is still 200.
 */
import { ChildProcess } from "node:child_process";

import { REFRESH_GRACE_MS } from "./auth/tokens";
import {
  call,
  DEMO_PASSWORD,
  line,
  removeDemoUser,
  resetDemoUser,
  startApi,
  stopApi,
  tokenPair,
} from "./auth/demo-harness";

const PORT = 21181;
const EMAIL = "demo-reuse@seed.local";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  let child: ChildProcess | undefined;
  const status = {
    login: 0,
    "r1-refresh": 0,
    "r1-reuse": 0,
    "r2-after-reuse": 0,
  };

  try {
    await resetDemoUser(EMAIL);
    child = await startApi(PORT);

    const login = await call(PORT, "/auth/login", {
      method: "POST",
      json: { email: EMAIL, password: DEMO_PASSWORD },
    });
    status.login = login.status;
    const first = tokenPair(login.json);

    const rotated = await call(PORT, "/auth/refresh", {
      method: "POST",
      json: { refresh_token: first.refresh },
    });
    status["r1-refresh"] = rotated.status;
    const second = tokenPair(rotated.json);

    await sleep(REFRESH_GRACE_MS + 1_000);

    status["r1-reuse"] = (
      await call(PORT, "/auth/refresh", { method: "POST", json: { refresh_token: first.refresh } })
    ).status;
    status["r2-after-reuse"] = (
      await call(PORT, "/auth/refresh", { method: "POST", json: { refresh_token: second.refresh } })
    ).status;
  } finally {
    for (const [key, value] of Object.entries(status)) line(key, value);
    await stopApi(child);
    await removeDemoUser(EMAIL);
  }

  const ok =
    status.login === 200 &&
    status["r1-refresh"] === 200 &&
    status["r1-reuse"] === 401 &&
    status["r2-after-reuse"] === 401;
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
