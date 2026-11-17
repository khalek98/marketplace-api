import { BeforeApplicationShutdown, Injectable } from "@nestjs/common";

/**
 * Shared readiness flag for /readyz and SIGTERM drain.
 * Nest closes the HTTP server only after beforeApplicationShutdown finishes,
 * so we can flip ready=false, wait DRAIN_MS, then let close proceed.
 */
@Injectable()
export class ReadinessService implements BeforeApplicationShutdown {
  private ready = false;

  isReady(): boolean {
    return this.ready;
  }

  markReady(): void {
    this.ready = true;
  }

  markNotReady(): void {
    this.ready = false;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.ready = false;
    const drainMs = Number(process.env.DRAIN_MS ?? 5000);
    if (drainMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, drainMs));
    }
  }
}
