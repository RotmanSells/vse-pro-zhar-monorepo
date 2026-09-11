import type { WheelQuestRepository } from "@vse-pro-zhar/database";

export const DEFAULT_QUEST_PROCESSOR_INTERVAL_MS = 1_000;

export interface QuestProcessorOptions {
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export class QuestProcessor {
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;

  constructor(private readonly repository: WheelQuestRepository, options: QuestProcessorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.intervalMs = options.intervalMs ?? DEFAULT_QUEST_PROCESSOR_INTERVAL_MS;
    this.onError = options.onError ?? (() => undefined);
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs <= 0) throw new Error("Invalid quest processor configuration");
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      while (true) {
        const candidate = await this.repository.claimNextQuestOrder();
        if (candidate === null) return processed;
        processed += 1;
        await this.repository.processQuestOrder(candidate.id, this.now());
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
    this.interval = setInterval(() => { void this.runOnce(); }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    while (this.running) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
