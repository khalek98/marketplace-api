/**
 * demo:auth — login, protected read, refresh, logout.
 * Prints key=number. Exit 1 when a status is not the one the demo promises.
 */
import { ChildProcess } from "node:child_process";

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

const PORT = 21180;
const EMAIL = "demo-auth@seed.local";

async function main(): Promise<void> {
  let child: ChildProcess | undefined;
  const status = {
    login: 0,
    "no-token": 0,
    "with-token": 0,
    refresh: 0,
    logout: 0,
    "after-logout": 0,
    "refresh-after-logout": 0,
  };

  try {
    await resetDemoUser(EMAIL);
    child = await startApi(PORT);

    const login = await call(PORT, "/auth/login", {
      method: "POST",
      json: { email: EMAIL, password: DEMO_PASSWORD },
    });
    status.login = login.status;
    const { access, refresh } = tokenPair(login.json);

    status["no-token"] = (await call(PORT, "/auth/me")).status;
    status["with-token"] = (await call(PORT, "/auth/me", { token: access })).status;

    const rotated = await call(PORT, "/auth/refresh", {
      method: "POST",
      json: { refresh_token: refresh },
    });
    status.refresh = rotated.status;
    const next = tokenPair(rotated.json);

    status.logout = (await call(PORT, "/auth/logout", { method: "POST", token: next.access })).status;
    status["after-logout"] = (await call(PORT, "/auth/me", { token: next.access })).status;
    status["refresh-after-logout"] = (
      await call(PORT, "/auth/refresh", { method: "POST", json: { refresh_token: next.refresh } })
    ).status;
  } finally {
    for (const [key, value] of Object.entries(status)) line(key, value);
    await stopApi(child);
    await removeDemoUser(EMAIL);
  }

  const ok =
    status.login === 200 &&
    status["no-token"] === 401 &&
    status["with-token"] === 200 &&
    status.refresh === 200 &&
    (status.logout === 200 || status.logout === 204) &&
    status["after-logout"] === 401 &&
    status["refresh-after-logout"] === 401;
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
