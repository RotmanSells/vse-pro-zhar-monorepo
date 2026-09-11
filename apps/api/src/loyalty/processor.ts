import type { LoyaltyRepository } from "@vse-pro-zhar/database";
import { LOYALTY_EARN_RULE_VERSION } from "@vse-pro-zhar/contracts";

import { LoyaltyService } from "./service.js";

export const DEFAULT_LOYALTY_PROCESSOR_INTERVAL_MS = 1_000;

export interface LoyaltyProcessorOptions {
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export class LoyaltyProcessor {
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly repository: LoyaltyRepository,
    private readonly service: LoyaltyService,
    options: LoyaltyProcessorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.intervalMs = options.intervalMs ?? DEFAULT_LOYALTY_PROCESSOR_INTERVAL_MS;
    this.onError = options.onError ?? (() => undefined);
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs <= 0) {
      throw new Error("Invalid loyalty processor configuration");
    }
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      while (true) {
        const now = this.now();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid loyalty processor clock");
        const candidate = await this.repository.claimNextEligibleOrder(LOYALTY_EARN_RULE_VERSION);
        if (candidate === null) return processed;
        processed += 1;
        await this.service.earnCompletedOrder(candidate.order.id, now);
      }
    } catch (error: unknown) {
      this.onError(error);
      return processed;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.interval !== null) return;
    void this.runOnce();
    this.interval = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    while (this.running) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}
