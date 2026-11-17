/**
 * Scan IMAGE with Trivy (container) and gate on a computed CVE count.
 *
 * Env:
 *   IMAGE          default marketplace-api:local
 *   SCAN_MAX       required — max allowed findings (gate = found <= SCAN_MAX)
 *   SCAN_SEVERITY  default CRITICAL,HIGH
 *   TRIVY_IMAGE    default aquasec/trivy:0.74.0
 *   TRIVY_CACHE    docker volume name, default marketplace-trivy-cache
 *
 * Prints: image= severity= found= max-allowed= gate=pass|fail
 * Exit 0 only when gate=pass.
 */
import { spawnSync } from "node:child_process";

const IMAGE = process.env.IMAGE ?? "marketplace-api:local";
const SEVERITY = process.env.SCAN_SEVERITY ?? "CRITICAL,HIGH";
const TRIVY_IMAGE = process.env.TRIVY_IMAGE ?? "aquasec/trivy:0.74.0";
const TRIVY_CACHE = process.env.TRIVY_CACHE ?? "marketplace-trivy-cache";
const SCAN_MAX_RAW = process.env.SCAN_MAX;

if (SCAN_MAX_RAW === undefined || SCAN_MAX_RAW === "") {
  console.error("SCAN_MAX is required (e.g. SCAN_MAX=50 npm run scan)");
  process.exit(2);
}

const maxAllowed = Number(SCAN_MAX_RAW);
if (!Number.isFinite(maxAllowed)) {
  console.error(`SCAN_MAX must be a number, got: ${SCAN_MAX_RAW}`);
  process.exit(2);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return {
    code: r.status ?? 1,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
}

const inspect = sh("docker", ["image", "inspect", IMAGE, "--format", "{{.Id}}"]);
if (inspect.code !== 0) {
  console.error(`image ${IMAGE} not found — run: npm run image:build`);
  process.exit(1);
}

sh("docker", ["volume", "create", TRIVY_CACHE]);

const haveTrivy = sh("docker", ["image", "inspect", TRIVY_IMAGE, "--format", "{{.Id}}"]);
if (haveTrivy.code !== 0) {
  const pull = sh("docker", ["pull", TRIVY_IMAGE], { timeout: 10 * 60_000 });
  if (pull.code !== 0) {
    console.error(`failed to pull ${TRIVY_IMAGE}: ${pull.err || pull.out}`);
    process.exit(1);
  }
}

const scan = sh(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${TRIVY_CACHE}:/root/.cache/`,
    TRIVY_IMAGE,
    "image",
    "--quiet",
    "--scanners",
    "vuln",
    "--severity",
    SEVERITY,
    "--format",
    "json",
    IMAGE,
  ],
  { timeout: 15 * 60_000 },
);

if (scan.code !== 0 && !scan.out) {
  console.error(`trivy failed: ${scan.err || scan.out}`);
  process.exit(1);
}

let found = 0;
try {
  const report = JSON.parse(scan.out || "{}");
  for (const result of report.Results ?? []) {
    found += (result.Vulnerabilities ?? []).length;
  }
} catch (err) {
  console.error(`could not parse trivy JSON: ${err instanceof Error ? err.message : err}`);
  console.error((scan.out || scan.err).slice(0, 400));
  process.exit(1);
}

const gate = found <= maxAllowed ? "pass" : "fail";

console.log(`image=${IMAGE}`);
console.log(`severity=${SEVERITY}`);
console.log(`found=${found}`);
console.log(`max-allowed=${maxAllowed}`);
console.log(`gate=${gate}`);

process.exit(gate === "pass" ? 0 : 1);
