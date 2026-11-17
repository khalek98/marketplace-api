import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { WebService } from "./components/webservice";

/**
 * Stack config (optional):
 *   pulumi config set profile good|bad
 *   pulumi config set rev 1
 *   pulumi config set replicas 2
 *
 * Required env (vault / SKIP_VAULT export) — no silent defaults:
 *   APP_DB_PASSWORD, PULUMI_CONFIG_PASSPHRASE
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`missing required env ${name}`);
    process.exit(1);
  }
  return value;
}

// Check before any resource constructors (criterion 5 names the variable).
const password = requireEnv("APP_DB_PASSWORD");
requireEnv("PULUMI_CONFIG_PASSPHRASE");

const cfg = new pulumi.Config();
const profile = cfg.get("profile") ?? "good";
const rev = cfg.get("rev") ?? "1";
const replicas = cfg.getNumber("replicas") ?? 2;
const good = profile === "good";

const ns = new k8s.core.v1.Namespace("marketplace", {
  metadata: { name: "marketplace" },
});

const appSecret = new k8s.core.v1.Secret(
  "marketplace-app",
  {
    metadata: {
      name: "marketplace-app",
      namespace: ns.metadata.name,
    },
    type: "Opaque",
    // data (base64), not stringData — keeps pulumi up idempotent across runs.
    data: {
      APP_DB_PASSWORD: Buffer.from(password, "utf8").toString("base64"),
    },
  },
  { dependsOn: [ns] },
);

const api = new WebService(
  "marketplace-api",
  {
    namespace: ns.metadata.name,
    image: "marketplace-api:local",
    args: ["dist/cluster-app.js"],
    replicas,
    nodePort: 30190,
    warmupMs: 4000,
    drainMs: 5000,
    graceful: good,
    probes: good,
    rev,
    pdbMinAvailable: good ? Math.max(replicas - 1, 1) : 0,
    hpaMinReplicas: Math.max(replicas, 2),
    hpaMaxReplicas: Math.max(replicas + 2, 4),
    secretName: appSecret.metadata.name,
  },
  { dependsOn: [ns, appSecret] },
);

export const activeProfile = profile;
export const revision = rev;
export const namespace = ns.metadata.name;
export const serviceName = api.service.metadata.name;
