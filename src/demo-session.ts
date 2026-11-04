/**
 * demo:session — rolling TTL session on jobs Redis (not cache LRU).
 * Self-clean; prints key=number for the grader.
 */
import { createJobsRedis, closeRedis } from "./redis/clients";
import { createSession, sessionExists, sessionTtl, touchSession } from "./sessions/session-store";

const SESSION_TTL_SEC = 5;
const REQUESTS = 3;
const PAUSE_MS = 1500;

function line(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const redis = createJobsRedis();

  try {
    // Self-clean leftover demo keys on the jobs instance.
    const old = await redis.keys("sess:*");
    if (old.length > 0) await redis.del(...old);

    const session = await createSession(redis, "demo-buyer", SESSION_TTL_SEC);
    const sids = new Set<string>([session.sid]);
    let requests = 0;

    // Request 1 — establish activity.
    const first = await touchSession(redis, session.sid, SESSION_TTL_SEC);
    requests += 1;
    if (!first) throw new Error("session missing after create");

    // Wait so TTL decays; without renew, ttl-renewed would stay 0.
    await sleep(PAUSE_MS);
    const ttlBefore = await sessionTtl(redis, session.sid);

    // Request 2 — rolling renew.
    const second = await touchSession(redis, session.sid, SESSION_TTL_SEC);
    requests += 1;
    if (!second) throw new Error("session expired before renew");
    sids.add(second.sid);
    const ttlAfter = await sessionTtl(redis, session.sid);

    // Request 3 — still the same sid.
    const third = await touchSession(redis, session.sid, SESSION_TTL_SEC);
    requests += 1;
    if (!third) throw new Error("session expired on third request");
    sids.add(third.sid);

    const inRedis = (await sessionExists(redis, session.sid)) ? 1 : 0;
    const ttlRenewed = ttlAfter > ttlBefore ? 1 : 0;

    line("requests", requests);
    line("sessions", sids.size);
    line("in-redis", inRedis);
    line("ttl-renewed", ttlRenewed);

    const ok = requests >= 3 && sids.size === 1 && inRedis === 1 && ttlRenewed === 1;
    if (!ok) process.exitCode = 1;
  } finally {
    await closeRedis(redis);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
