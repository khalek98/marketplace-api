import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface WebServiceArgs {
  namespace: pulumi.Input<string>;
  image: string;
  /** Passed as args to distroless ENTRYPOINT (node). */
  args: string[];
  replicas: number;
  nodePort: number;
  warmupMs: number;
  drainMs: number;
  graceful: boolean;
  /** When false: no probes, maxUnavailable: 1 (bad rollout profile). */
  probes: boolean;
  rev: string;
  /** PDB minAvailable; 0 skips PDB. */
  pdbMinAvailable: number;
  hpaMinReplicas: number;
  hpaMaxReplicas: number;
  /** Secret name in the same namespace; key APP_DB_PASSWORD. */
  secretName: pulumi.Input<string>;
  containerPort?: number;
}

export class WebService extends pulumi.ComponentResource {
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;

  constructor(name: string, args: WebServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super("marketplace:k8s:WebService", name, {}, opts);

    const port = args.containerPort ?? 8080;
    const labels = { app: name };
    const childOpts = { parent: this };

    const env = [
      { name: "PORT", value: String(port) },
      { name: "WARMUP_MS", value: String(args.warmupMs) },
      { name: "DRAIN_MS", value: String(args.drainMs) },
      { name: "GRACEFUL", value: args.graceful ? "1" : "0" },
      { name: "REV", value: args.rev },
      {
        name: "APP_DB_PASSWORD",
        valueFrom: {
          secretKeyRef: {
            name: args.secretName,
            key: "APP_DB_PASSWORD",
          },
        },
      },
    ];

    this.deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: { name, namespace: args.namespace, labels },
        spec: {
          replicas: args.replicas,
          selector: { matchLabels: labels },
          strategy: {
            type: "RollingUpdate",
            rollingUpdate: args.probes ? { maxUnavailable: 0, maxSurge: 1 } : { maxUnavailable: 1, maxSurge: 1 },
          },
          template: {
            metadata: { labels },
            spec: {
              terminationGracePeriodSeconds: args.probes ? 20 : 30,
              securityContext: {
                runAsNonRoot: true,
                runAsUser: 65532,
              },
              containers: [
                {
                  name: "app",
                  image: args.image,
                  imagePullPolicy: "IfNotPresent",
                  args: args.args,
                  ports: [{ containerPort: port }],
                  env,
                  resources: {
                    requests: { cpu: "20m", memory: "48Mi" },
                    limits: { memory: "192Mi" },
                  },
                  ...(args.probes
                    ? {
                        readinessProbe: {
                          httpGet: { path: "/readyz", port },
                          periodSeconds: 1,
                          failureThreshold: 1,
                        },
                        livenessProbe: {
                          httpGet: { path: "/healthz", port },
                          initialDelaySeconds: 15,
                          periodSeconds: 10,
                          failureThreshold: 3,
                        },
                      }
                    : {}),
                },
              ],
            },
          },
        },
      },
      childOpts,
    );

    this.service = new k8s.core.v1.Service(
      name,
      {
        metadata: { name, namespace: args.namespace, labels },
        spec: {
          type: "NodePort",
          selector: labels,
          ports: [{ port: 80, targetPort: port, nodePort: args.nodePort }],
        },
      },
      { ...childOpts, dependsOn: [this.deployment] },
    );

    if (args.pdbMinAvailable > 0) {
      new k8s.policy.v1.PodDisruptionBudget(
        name,
        {
          metadata: { name, namespace: args.namespace, labels },
          spec: {
            minAvailable: args.pdbMinAvailable,
            selector: { matchLabels: labels },
          },
        },
        childOpts,
      );
    }

    new k8s.autoscaling.v2.HorizontalPodAutoscaler(
      name,
      {
        metadata: { name, namespace: args.namespace, labels },
        spec: {
          scaleTargetRef: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name,
          },
          minReplicas: args.hpaMinReplicas,
          maxReplicas: args.hpaMaxReplicas,
          metrics: [
            {
              type: "Resource",
              resource: {
                name: "cpu",
                target: { type: "Utilization", averageUtilization: 70 },
              },
            },
          ],
        },
      },
      { ...childOpts, dependsOn: [this.deployment] },
    );

    this.registerOutputs({
      deployment: this.deployment.metadata.name,
      service: this.service.metadata.name,
    });
  }
}
