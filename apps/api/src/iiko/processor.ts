import type {
  FulfillmentOrderStatus,
  IikoDispatchRepository,
  IikoDispatchStatus
} from "@vse-pro-zhar/database";

import {
  IikoFulfillmentProviderError,
  type IikoFulfillmentProvider
} from "./fulfillment.js";

export const DEFAULT_IIKO_DISPATCH_MAX_ATTEMPTS = 12;
export const DEFAULT_IIKO_DISPATCH_LEASE_MS = 30_000;
export const DEFAULT_IIKO_DISPATCH_POLL_MS = 1_000;
export const DEFAULT_IIKO_DISPATCH_RETRY_DELAYS_MS = [
  100,
  500,
  1_000,
  2_000,
  5_000
] as const;

export interface IikoDispatchProcessorOptions {
  readonly now?: () => Date;
  readonly maxAttempts?: number;
  readonly leaseMs?: number;
  readonly pollMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export type MappedFulfillmentStatus = Exclude<
  FulfillmentOrderStatus,
  "pending_payment" | "payment_confirmed" | "canceled"
>;

type ClaimedDispatch = NonNullable<
  Awaited<ReturnType<IikoDispatchRepository["claimNextDue"]>>
>;

export function mapIikoOrderStatus(
  status: string
): MappedFulfillmentStatus | null {
  switch (status) {
    case "WaitCooking":
    case "ReadyForCooking":
      return "kitchen_accepted";
    case "CookingStarted":
      return "preparing";
    case "CookingCompleted":
    case "Waiting":
      return "ready_for_pickup";
    case "Closed":
      return "completed";
    case "Cancelled":
      return "fulfillment_problem";
    default:
      return null;
  }
}

function safeNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Invalid processor clock");
  }
  return value;
}

function nextRetryAt(
  now: Date,
  attemptCount: number,
  retryDelaysMs: readonly number[]
): Date {
  const delay = retryDelaysMs[Math.min(attemptCount - 1, retryDelaysMs.length - 1)] ?? 0;
  return new Date(now.getTime() + delay);
}

function terminalAt(now: Date): Date {
  return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
}

export class IikoDispatchProcessor {
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly intervalMs: number;

  constructor(
    private readonly repository: IikoDispatchRepository,
    private readonly provider: IikoFulfillmentProvider,
    options: IikoDispatchProcessorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? DEFAULT_IIKO_DISPATCH_MAX_ATTEMPTS;
    this.leaseMs = options.leaseMs ?? DEFAULT_IIKO_DISPATCH_LEASE_MS;
    this.pollMs = options.pollMs ?? DEFAULT_IIKO_DISPATCH_POLL_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_IIKO_DISPATCH_RETRY_DELAYS_MS;
    this.intervalMs = options.intervalMs ?? 1_000;
    this.onError = options.onError ?? (() => undefined);

    if (
      !Number.isSafeInteger(this.maxAttempts) ||
      this.maxAttempts < 1 ||
      !Number.isSafeInteger(this.leaseMs) ||
      this.leaseMs <= 0 ||
      !Number.isSafeInteger(this.pollMs) ||
      this.pollMs <= 0 ||
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs <= 0 ||
      this.retryDelaysMs.length === 0 ||
      this.retryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0)
    ) {
      throw new Error("Invalid iiko dispatch processor configuration");
    }
  }

  private readonly onError: (error: unknown) => void;

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      while (true) {
        const claimed = await this.repository.claimNextDue(safeNow(this.now), this.leaseMs);
        if (claimed === null) return processed;
        processed += 1;
        await this.processClaimed(claimed);
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

  private async processClaimed(claimed: ClaimedDispatch): Promise<void> {
    const now = safeNow(this.now);
    const dispatch = claimed.dispatch;
    const attemptCount = dispatch.attemptCount + 1;

    try {
      if (dispatch.status === "command_pending") {
        await this.processCommandPending(claimed, attemptCount, now);
        return;
      }
      if (dispatch.status === "submitted") {
        await this.processSubmitted(claimed, attemptCount, now);
        return;
      }

      if (attemptCount > this.maxAttempts) {
        await this.repository.failDispatch(
          dispatch.id,
          claimed.order.id,
          "retry_exhausted",
          now,
          dispatch.attemptCount
        );
        return;
      }
      const result = await this.provider.createOrder({
        order: claimed,
        correlationId: dispatch.correlationId
      });
      await this.repository.updateDispatch(
        dispatch.id,
        {
          status: result.state,
          providerOrderId: result.providerOrderId,
          commandId: result.commandId,
          attemptCount,
          nextAttemptAt:
            result.state === "command_pending"
              ? new Date(now.getTime() + this.pollMs)
              : now,
          lastErrorCode: null
        },
        now
      );
    } catch (error: unknown) {
      await this.handleError(claimed, attemptCount, now, error);
    }
  }

  private async processCommandPending(
    claimed: ClaimedDispatch,
    attemptCount: number,
    now: Date
  ): Promise<void> {
    if (claimed.dispatch.commandId === null) {
      await this.repository.failDispatch(
        claimed.dispatch.id,
        claimed.order.id,
        "missing_command_id",
        now,
        claimed.dispatch.attemptCount
      );
      return;
    }
    const result = await this.provider.getCommandStatus(claimed.dispatch.commandId);
    await this.repository.updateDispatch(
      claimed.dispatch.id,
      {
        status: result.state === "succeeded" ? "submitted" : "command_pending",
        providerOrderId: claimed.dispatch.providerOrderId,
        commandId: claimed.dispatch.commandId,
        attemptCount,
        nextAttemptAt:
          result.state === "succeeded"
            ? now
            : new Date(now.getTime() + this.pollMs),
        lastErrorCode: null
      },
      now
    );
  }

  private async processSubmitted(
    claimed: ClaimedDispatch,
    attemptCount: number,
    now: Date
  ): Promise<void> {
    if (claimed.dispatch.providerOrderId === null) {
      await this.repository.failDispatch(
        claimed.dispatch.id,
        claimed.order.id,
        "missing_provider_order_id",
        now,
        claimed.dispatch.attemptCount
      );
      return;
    }
    const result = await this.provider.getOrder({
      providerOrderId: claimed.dispatch.providerOrderId,
      expectedTotalMinor: claimed.order.totalMinor
    });
    const mapped = mapIikoOrderStatus(result.status);
    if (mapped === "fulfillment_problem") {
      await this.repository.failDispatch(
        claimed.dispatch.id,
        claimed.order.id,
        "provider_cancelled",
        now,
        attemptCount
      );
      return;
    }
    if (mapped !== null) {
      await this.repository.applyOrderStatus(claimed.order.id, mapped, now);
    }
    await this.repository.updateDispatch(
      claimed.dispatch.id,
      {
        status: "submitted",
        providerOrderId: claimed.dispatch.providerOrderId,
        commandId: claimed.dispatch.commandId,
        attemptCount,
        nextAttemptAt:
          mapped === "completed"
            ? terminalAt(now)
            : new Date(now.getTime() + this.pollMs),
        lastErrorCode: null
      },
      now
    );
  }

  private async handleError(
    claimed: ClaimedDispatch,
    attemptCount: number,
    now: Date,
    error: unknown
  ): Promise<void> {
    const providerError =
      error instanceof IikoFulfillmentProviderError
        ? error
        : new IikoFulfillmentProviderError("terminal", "processor_error");
    if (
      providerError.kind === "retryable" &&
      attemptCount < this.maxAttempts
    ) {
      await this.repository.updateDispatch(
        claimed.dispatch.id,
        {
          status: claimed.dispatch.status as IikoDispatchStatus,
          providerOrderId: claimed.dispatch.providerOrderId,
          commandId: claimed.dispatch.commandId,
          attemptCount,
          nextAttemptAt: nextRetryAt(now, attemptCount, this.retryDelaysMs),
          lastErrorCode: providerError.code
        },
        now
      );
      return;
    }
    await this.repository.failDispatch(
      claimed.dispatch.id,
      claimed.order.id,
      providerError.kind === "retryable" ? "retry_exhausted" : providerError.code,
      now,
      attemptCount
    );
  }
}
