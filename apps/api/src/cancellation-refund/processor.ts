import type { CancellationRefundRepository } from "@vse-pro-zhar/database";

import { CancellationRefundService } from "./service.js";

export const DEFAULT_REFUND_MAX_ATTEMPTS = 12;
export const DEFAULT_REFUND_LEASE_MS = 30_000;

export interface RefundProcessorOptions {
  readonly now?: () => Date;
  readonly maxAttempts?: number;
  readonly leaseMs?: number;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export class RefundProcessor {
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly repository: CancellationRefundRepository,
    private readonly service: CancellationRefundService,
    options: RefundProcessorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? DEFAULT_REFUND_MAX_ATTEMPTS;
    this.leaseMs = options.leaseMs ?? DEFAULT_REFUND_LEASE_MS;
    this.intervalMs = options.intervalMs ?? 1_000;
    this.onError = options.onError ?? (() => undefined);
    if (
      !Number.isSafeInteger(this.maxAttempts) ||
      this.maxAttempts < 1 ||
      !Number.isSafeInteger(this.leaseMs) ||
      this.leaseMs <= 0 ||
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs <= 0
    ) {
      throw new Error("Invalid refund processor configuration");
    }
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      while (true) {
        const claimed = await this.repository.claimNextDue(this.now(), this.leaseMs);
        if (claimed === null) return processed;
        processed += 1;
        await this.service.processClaimedRefund(claimed, this.maxAttempts);
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
