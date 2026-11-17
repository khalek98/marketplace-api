/**
 * demo:pdb — measure Eviction API against PodDisruptionBudget.
 *
 * Contract (from API / cluster state, not hard-coded):
 *   healthy=… minAvailable=… evict-1=201 evict-2=429
 *
 * Uses Eviction API (not kubectl delete — PDB does not apply to delete).
 * kubectl ≥1.33: create --raw without -o (mutually exclusive).
 *
 * Env:
 *   KUBE_CONTEXT  default kind-marketplace
 *   DEPLOY_NS     default marketplace
 *   PDB_NAME      default marketplace-api
 *   APP_LABEL     default app=marketplace-api
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CTX = process.env.KUBE_CONTEXT ?? "kind-marketplace";
const NS = process.env.DEPLOY_NS ?? "marketplace";
const PDB = process.env.PDB_NAME ?? "marketplace-api";
const APP_LABEL = process.env.APP_LABEL ?? "app=marketplace-api";

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
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

function kubectl(args, opts = {}) {
  return sh("kubectl", ["--context", CTX, ...args], opts);
}

function pdbState() {
  const r = kubectl([
    "get",
    "pdb",
    PDB,
    "-n",
    NS,
    "-o",
    "jsonpath={.spec.minAvailable} {.status.currentHealthy} {.status.disruptionsAllowed}",
  ]);
  if (r.code !== 0) fail(`get pdb failed: ${r.err || r.out}`);
  const [min, healthy, allowed] = r.out.split(/\s+/);
  return {
    minAvailable: min ?? "",
    healthy: Number(healthy ?? NaN),
    allowed: Number(allowed ?? NaN),
  };
}

function runningPods() {
  const r = kubectl([
    "get",
    "pods",
    "-n",
    NS,
    "-l",
    APP_LABEL,
    "--field-selector=status.phase=Running",
    "-o",
    'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}',
  ]);
  if (r.code !== 0) fail(`list pods failed: ${r.err || r.out}`);
  return r.out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * POST Eviction; return HTTP status measured from the API response.
 * No -o with --raw (kubectl 1.33+ rejects that combo).
 */
function evict(pod) {
  const tmp = mkdtempSync(join(tmpdir(), "hw28-evict-"));
  const file = join(tmp, "eviction.json");
  writeFileSync(
    file,
    JSON.stringify({
      apiVersion: "policy/v1",
      kind: "Eviction",
      metadata: { name: pod, namespace: NS },
    }),
  );
  try {
    const path = `/api/v1/namespaces/${NS}/pods/${pod}/eviction`;
    const r = kubectl(["create", "-f", file, `--raw=${path}`]);
    const text = `${r.out}\n${r.err}`;

    // Success body often includes "code":201 or status Success.
    const codeMatch = text.match(/"code"\s*:\s*(\d+)/);
    if (codeMatch) return Number(codeMatch[1]);

    if (/TooManyRequests/i.test(text)) return 429;
    if (/"status"\s*:\s*"Success"/i.test(text) || (r.code === 0 && /eviction/i.test(text))) {
      return 201;
    }
    if (/already|NotFound|not found/i.test(text) && r.code !== 0) {
      // Pod gone mid-flight — not a valid measurement.
      fail(`eviction of ${pod} unexpected: ${text.slice(0, 240)}`);
    }
    fail(`could not measure eviction status for ${pod}: exit=${r.code} ${text.slice(0, 240)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Wait until PDB allows at least one disruption (healthy replicas up).
let state = pdbState();
for (let i = 0; i < 60 && !(state.allowed >= 1 && state.healthy >= 2); i++) {
  sh("bash", ["-c", "sleep 2"]);
  state = pdbState();
}
if (!(state.allowed >= 1)) {
  fail(
    `disruptionsAllowed=${state.allowed} (need ≥1 before demo). ` +
      `minAvailable=${state.minAvailable} healthy=${state.healthy}. ` +
      `If minAvailable==replicas, PDB blocks every drain.`,
  );
}

const pods = runningPods();
if (pods.length < 2) fail(`need ≥2 running pods, got ${pods.length}: ${pods.join(", ")}`);

const evict1 = evict(pods[0]);
const evict2 = evict(pods[1]);

console.log(`healthy=${state.healthy}`);
console.log(`minAvailable=${state.minAvailable}`);
console.log(`evict-1=${evict1}`);
console.log(`evict-2=${evict2}`);

if (evict1 !== 201 || evict2 !== 429) process.exit(1);
