import {
  AdminAnalyticsResponseSchema,
  type AdminAnalyticsPeriod,
  type AdminAnalyticsResponse
} from "@vse-pro-zhar/contracts";

import { AdminAnalyticsClientError, type AdminAnalyticsClient } from "./admin-analytics-client.js";

export type AdminAnalyticsState =
  | { readonly status: "idle" | "loading"; readonly days: AdminAnalyticsPeriod }
  | { readonly status: "success"; readonly days: AdminAnalyticsPeriod; readonly response: AdminAnalyticsResponse }
  | { readonly status: "error"; readonly days: AdminAnalyticsPeriod; readonly message: string };

export interface AdminAnalyticsRequestController {
  load(days: AdminAnalyticsPeriod): void;
  retry(): void;
  dispose(): void;
}

export function getAdminAnalyticsErrorMessage(error: unknown): string {
  return error instanceof AdminAnalyticsClientError ? error.message : "Не удалось получить аналитику";
}

export function createAdminAnalyticsRequestController(
  client: AdminAnalyticsClient,
  onStateChange: (state: AdminAnalyticsState) => void,
  initialDays: AdminAnalyticsPeriod = 30
): AdminAnalyticsRequestController {
  let disposed = false;
  let sequence = 0;
  let lastDays = initialDays;
  let activeController: AbortController | null = null;

  const load = (days: AdminAnalyticsPeriod): void => {
    if (disposed) return;
    lastDays = days;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    onStateChange({ status: "loading", days });
    void client.get({ days }, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && currentSequence === sequence && !controller.signal.aborted) {
          const parsed = AdminAnalyticsResponseSchema.safeParse(response);
          onStateChange(parsed.success ? { status: "success", days, response: parsed.data } : { status: "error", days, message: "Backend API вернул некорректную аналитику" });
        }
      },
      (error: unknown) => {
        if (!disposed && currentSequence === sequence && !(error instanceof AdminAnalyticsClientError && error.kind === "aborted")) {
          onStateChange({ status: "error", days, message: getAdminAnalyticsErrorMessage(error) });
        }
      }
    );
  };

  return {
    load,
    retry: () => load(lastDays),
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      activeController?.abort();
      activeController = null;
    }
  };
}
