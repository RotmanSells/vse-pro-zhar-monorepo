import {
  LoyaltyLedgerResponseSchema,
  LoyaltySummaryResponseSchema,
  type LoyaltyLedgerQueryInput,
  type LoyaltyLedgerResponse,
  type LoyaltySummaryResponse
} from "@vse-pro-zhar/contracts";

import { LoyaltyClientError, type LoyaltyClient } from "./loyalty-client.js";

export type LoyaltySummaryRequestState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: LoyaltySummaryResponse }
  | { readonly status: "error"; readonly message: string };
export type LoyaltyLedgerRequestState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: LoyaltyLedgerResponse }
  | { readonly status: "error"; readonly message: string };

export interface LoyaltyRequestController {
  start(query?: LoyaltyLedgerQueryInput): void;
  retry(): void;
  loadLedger(query?: LoyaltyLedgerQueryInput): void;
  dispose(): void;
}

export function getLoyaltyErrorMessage(error: unknown): string {
  return error instanceof LoyaltyClientError
    ? error.message
    : "Не удалось загрузить программу лояльности";
}

export function createLoyaltyRequestController(
  client: LoyaltyClient,
  onSummary: (state: LoyaltySummaryRequestState) => void,
  onLedger: (state: LoyaltyLedgerRequestState) => void
): LoyaltyRequestController {
  let disposed = false;
  let summarySequence = 0;
  let ledgerSequence = 0;
  let summaryController: AbortController | null = null;
  let ledgerController: AbortController | null = null;
  let lastQuery: LoyaltyLedgerQueryInput = {};

  const loadSummary = (): void => {
    if (disposed) return;
    const sequence = ++summarySequence;
    summaryController?.abort();
    const controller = new AbortController();
    summaryController = controller;
    onSummary({ status: "loading" });
    void client.getSummary({ signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === summarySequence && !controller.signal.aborted) {
          const parsed = LoyaltySummaryResponseSchema.safeParse(response);
          onSummary(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректное состояние лояльности" });
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === summarySequence && !(error instanceof LoyaltyClientError && error.kind === "aborted")) onSummary({ status: "error", message: getLoyaltyErrorMessage(error) });
      }
    );
  };

  const loadLedger = (query: LoyaltyLedgerQueryInput = lastQuery): void => {
    if (disposed) return;
    lastQuery = query;
    const sequence = ++ledgerSequence;
    ledgerController?.abort();
    const controller = new AbortController();
    ledgerController = controller;
    onLedger({ status: "loading" });
    void client.getLedger(query, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === ledgerSequence && !controller.signal.aborted) {
          const parsed = LoyaltyLedgerResponseSchema.safeParse(response);
          onLedger(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректную историю лояльности" });
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === ledgerSequence && !(error instanceof LoyaltyClientError && error.kind === "aborted")) onLedger({ status: "error", message: getLoyaltyErrorMessage(error) });
      }
    );
  };

  return {
    start: (query = {}) => { lastQuery = query; loadSummary(); loadLedger(query); },
    retry: () => { loadSummary(); loadLedger(lastQuery); },
    loadLedger,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      summarySequence += 1;
      ledgerSequence += 1;
      summaryController?.abort();
      ledgerController?.abort();
    }
  };
}
