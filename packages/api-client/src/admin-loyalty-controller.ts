import {
  AdminLoyaltyLedgerResponseSchema,
  type AdminLoyaltyLedgerResponse,
  type AdminLoyaltyQueryInput
} from "@vse-pro-zhar/contracts";

import { AdminLoyaltyClientError, type AdminLoyaltyClient } from "./admin-loyalty-client.js";

export type AdminLoyaltyLedgerState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: AdminLoyaltyLedgerResponse }
  | { readonly status: "error"; readonly message: string };

export interface AdminLoyaltyRequestController {
  load(query?: AdminLoyaltyQueryInput): void;
  retry(): void;
  dispose(): void;
}

export function getAdminLoyaltyErrorMessage(error: unknown): string {
  return error instanceof AdminLoyaltyClientError
    ? error.message
    : "Не удалось загрузить историю лояльности";
}

export function createAdminLoyaltyRequestController(
  client: AdminLoyaltyClient,
  onState: (state: AdminLoyaltyLedgerState) => void
): AdminLoyaltyRequestController {
  let disposed = false;
  let sequence = 0;
  let controller: AbortController | null = null;
  let lastQuery: AdminLoyaltyQueryInput = {};
  const load = (query: AdminLoyaltyQueryInput = lastQuery): void => {
    if (disposed) return;
    lastQuery = query;
    const currentSequence = ++sequence;
    controller?.abort();
    controller = new AbortController();
    onState({ status: "loading" });
    void client.list(query, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && currentSequence === sequence && controller?.signal.aborted !== true) {
          const parsed = AdminLoyaltyLedgerResponseSchema.safeParse(response);
          onState(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректную историю лояльности" });
        }
      },
      (error: unknown) => {
        if (!disposed && currentSequence === sequence && !(error instanceof AdminLoyaltyClientError && error.kind === "aborted")) onState({ status: "error", message: getAdminLoyaltyErrorMessage(error) });
      }
    );
  };
  return {
    load,
    retry: () => load(lastQuery),
    dispose: () => { if (!disposed) { disposed = true; sequence += 1; controller?.abort(); } }
  };
}
