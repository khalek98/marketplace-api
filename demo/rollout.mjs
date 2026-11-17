/**
 * demo:rollout — measure failed responses during a rolling update.
 *
 * Contract (counted from the load file, never hard-coded):
 *   profile=… requests=… ok=… failed=… rollout-seconds=…
 *
 * Env:
 *   PROFILE          good|bad (default good)
 *   LOAD_URL         default http://127.0.0.1:21190/
 *   LOAD_SECS        default 90
 *   LOAD_WORKERS     default 4
 *   KUBE_CONTEXT     default kind-marketplace
 *   DEPLOY_NAME      default marketplace-api
 *   DEPLOY_NS        default marketplace
 *   APP_DB_PASSWORD, PULUMI_CONFIG_PASSPHRASE, PULUMI_BACKEND_URL
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PROFILE = process.env.PROFILE ?? "good";
const LOAD_URL = process.env.LOAD_URL ?? "http://127.0.0.1:21190/";
const LOAD_SECS = Number(process.env.LOAD_SECS ?? 90);
const LOAD_WORKERS = Number(process.env.LOAD_WORKERS ?? 4);
const CTX = process.env.KUBE_CONTEXT ?? "kind-marketplace";
const DEPLOY = process.env.DEPLOY_NAME ?? "marketplace-api";
const NS = process.env.DEPLOY_NS ?? "marketplace";
const STACK = process.env.PULUMI_STACK ?? "dev";

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  });
  return {
    code: r.status ?? 1,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === "") fail(`missing required env ${name}`);
  return v;
}

requireEnv("APP_DB_PASSWORD");
requireEnv("PULUMI_CONFIG_PASSPHRASE");
process.env.PULUMI_BACKEND_URL ??= `file://${ROOT}/.pulumi`;
process.env.PULUMI_SKIP_UPDATE_CHECK ??= "true";

if (!["good", "bad"].includes(PROFILE)) fail(`PROFILE must be good|bad, got ${PROFILE}`);
if (!commandOk("pulumi")) fail("pulumi CLI not found");
if (!commandOk("kubectl")) fail("kubectl not found");

function commandOk(bin) {
  return sh("bash", ["-c", `command -v ${bin}`]).code === 0;
}

function kubectl(args) {
  return sh("kubectl", ["--context", CTX, ...args]);
}

function pulumi(args) {
  return sh("pulumi", args, {
    cwd: join(ROOT, "infra"),
    env: process.env,
  });
}

function setConfig(map) {
  for (const [k, v] of Object.entries(map)) {
    const r = pulumi(["config", "set", k, String(v), "--stack", STACK, "--non-interactive"]);
    if (r.code !== 0) fail(`pulumi config set ${k} failed: ${r.err || r.out}`);
  }
}

function pulumiUp() {
  const r = pulumi(["up", "--yes", "--non-interactive", "--stack", STACK]);
  if (r.code !== 0) fail(`pulumi up failed: ${r.err || r.out}`);
}

function waitReady(timeoutSec = 180) {
  const r = kubectl(["rollout", "status", `deploy/${DEPLOY}`, "-n", NS, `--timeout=${timeoutSec}s`]);
  if (r.code !== 0) fail(`rollout status failed: ${r.err || r.out}`);
}

function waitHttp200(timeoutSec = 90) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = sh("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "2", LOAD_URL]);
    if (r.out === "200") return;
    sh("bash", ["-c", "sleep 1"]);
  }
  fail(`service at ${LOAD_URL} did not return 200 within ${timeoutSec}s`);
}

const tmp = mkdtempSync(join(tmpdir(), "hw28-rollout-"));
const outFile = join(tmp, "load.txt");

try {
  // Baseline: selected profile + known rev, wait until healthy.
  const baseRev = `${PROFILE}-${Date.now().toString(36)}`;
  setConfig({ profile: PROFILE, rev: baseRev, replicas: "2" });
  pulumiUp();
  waitReady(180);
  waitHttp200(120);

  // Start load in background (same contract as lecture load.sh).
  const load = spawnSync(
    "bash",
    [
      "-c",
      `nohup bash '${join(ROOT, "scripts/load.sh")}' '${LOAD_URL}' ${LOAD_SECS} ${LOAD_WORKERS} '${outFile}' >/dev/null 2>&1 & echo $!`,
    ],
    { encoding: "utf8" },
  );
  if (load.status !== 0) fail(`failed to start load: ${load.stderr}`);
  sh("bash", ["-c", "sleep 4"]);

  // Trigger rolling update by changing REV under load.
  const t0 = Date.now();
  setConfig({ rev: `${baseRev}-next` });
  pulumiUp();
  waitReady(300);
  const rolloutSeconds = Math.round((Date.now() - t0) / 1000);

  // Wait until load generator finishes.
  for (let i = 0; i < LOAD_SECS + 60; i++) {
    if (existsSync(`${outFile}.done`)) break;
    sh("bash", ["-c", "sleep 1"]);
  }

  const codes = existsSync(outFile) ? readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean) : [];
  const requests = codes.length;
  const ok = codes.filter((c) => c === "200").length;
  const failed = requests - ok;

  console.log(`profile=${PROFILE}`);
  console.log(`requests=${requests}`);
  console.log(`ok=${ok}`);
  console.log(`failed=${failed}`);
  console.log(`rollout-seconds=${rolloutSeconds}`);

  // Leave stack on good profile so the next demo is not poisoned.
  if (PROFILE !== "good") {
    setConfig({ profile: "good", rev: `good-reset-${Date.now().toString(36)}` });
    pulumiUp();
    waitReady(180);
  }

  if (requests < 5000) {
    fail(`requests=${requests} < 5000 — increase LOAD_SECS/LOAD_WORKERS`);
  }
  if (failed !== 0) {
    process.exit(1);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
