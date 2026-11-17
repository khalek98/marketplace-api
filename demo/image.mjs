/**
 * Measure production image contract (HW-28 demo:image).
 * Prints key=number lines. Numbers are counted, never hard-coded.
 *
 * Env: IMAGE (default marketplace-api:local), TOKEN_FILE (default .npm_token)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const IMAGE = process.env.IMAGE ?? "marketplace-api:local";
const TOKEN_FILE = resolve(ROOT, process.env.TOKEN_FILE ?? ".npm_token");
const DOCKERFILE = resolve(ROOT, "docker/Dockerfile");

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

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!existsSync(TOKEN_FILE)) {
  fail(`missing ${TOKEN_FILE} — create bait token: printf 'dummy-npm-token' > .npm_token`);
}
if (!existsSync(DOCKERFILE)) {
  fail(`missing ${DOCKERFILE}`);
}

const inspect = sh("docker", ["image", "inspect", IMAGE, "--format", "{{.Id}}"]);
if (inspect.code !== 0) {
  fail(`image ${IMAGE} not found — run: npm run image:build`);
}

const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();
if (TOKEN.length < 8) {
  fail("token in .npm_token is too short to search for reliably");
}

/** stages — count FROM lines in the canonical Dockerfile */
const stages = readFileSync(DOCKERFILE, "utf8")
  .split("\n")
  .filter((line) => /^\s*FROM\s+/i.test(line)).length;

/** shell-inside — try to exec sh (not grep Dockerfile) */
const shell = sh("docker", ["run", "--rm", "--entrypoint", "sh", IMAGE, "-c", "echo shell-ok"]);
const shellInside = shell.code === 0 ? 1 : 0;

/** runtime-uid — ENTRYPOINT is already node; -e replaces CMD */
const uidRun = sh("docker", ["run", "--rm", IMAGE, "-e", "console.log(process.getuid())"]);
const runtimeUid = Number((uidRun.out.match(/^\d+/m) ?? [])[0] ?? "");
if (!Number.isFinite(runtimeUid)) {
  fail(`could not read runtime uid from: out=${uidRun.out} err=${uidRun.err}`);
}

/** token-in-history */
const history = sh("docker", ["history", "--no-trunc", "--format", "{{.CreatedBy}}", IMAGE]);
const tokenInHistory = history.out.split("\n").filter((line) => line.includes(TOKEN)).length;

/**
 * token-in-config / token-in-layers — one docker save unpack (lecture step 2).
 * Config JSON has "rootfs"; layer blobs are tar archives.
 */
function scanSaved(dir) {
  const hits = sh("bash", ["-c", `grep -rla -- '${TOKEN.replace(/'/g, `'\\''`)}' '${dir}' 2>/dev/null || true`])
    .out.split("\n")
    .filter(Boolean);

  let cfg = 0;
  let layers = 0;
  for (const file of hits) {
    const isTar = sh("bash", ["-c", `tar -tf '${file}' >/dev/null 2>&1 && echo yes || echo no`]).out === "yes";
    if (isTar) {
      layers += 1;
      continue;
    }
    const hasRootfs = sh("bash", ["-c", `grep -q '"rootfs"' '${file}' && echo yes || echo no`]).out === "yes";
    if (hasRootfs) {
      cfg += Number(
        sh("bash", ["-c", `grep -o -- '${TOKEN.replace(/'/g, `'\\''`)}' '${file}' | wc -l | tr -d ' '`]).out || 0,
      );
    }
  }
  return { cfg, layers };
}

const unpackDir = mkdtempSync(join(tmpdir(), "hw28-img-"));
try {
  // docker save | tar -x
  execFileSync("bash", ["-c", `docker save '${IMAGE}' | tar -x -C '${unpackDir}'`], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
  const { cfg, layers } = scanSaved(unpackDir);

  console.log(`stages=${stages}`);
  console.log(`shell-inside=${shellInside}`);
  console.log(`runtime-uid=${runtimeUid}`);
  console.log(`token-in-history=${tokenInHistory}`);
  console.log(`token-in-config=${cfg}`);
  console.log(`token-in-layers=${layers}`);
} finally {
  rmSync(unpackDir, { recursive: true, force: true });
}
