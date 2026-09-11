import { AdminCustomersResponseSchema, type AdminCustomersQueryInput, type AdminCustomersResponse } from "@vse-pro-zhar/contracts";

import { AdminCustomersClientError, type AdminCustomersClient } from "./admin-customers-client.js";

export type AdminCustomersState =
  | { readonly status: "idle" | "loading"; readonly query: AdminCustomersQueryInput }
  | { readonly status: "success"; readonly query: AdminCustomersQueryInput; readonly response: AdminCustomersResponse }
  | { readonly status: "error"; readonly query: AdminCustomersQueryInput; readonly message: string };

export interface AdminCustomersRequestController {
  load(query?: AdminCustomersQueryInput): void;
  retry(): void;
  dispose(): void;
}

export function getAdminCustomersErrorMessage(error: unknown): string {
  return error instanceof AdminCustomersClientError ? error.message : "Не удалось загрузить список клиентов";
}

export function createAdminCustomersRequestController(
  client: AdminCustomersClient,
  onStateChange: (state: AdminCustomersState) => void
): AdminCustomersRequestController {
  let disposed = false;
  let sequence = 0;
  let lastQuery: AdminCustomersQueryInput = { limit: 25, offset: 0, search: "" };
  let activeController: AbortController | null = null;
  const load = (query: AdminCustomersQueryInput = lastQuery): void => {
    if (disposed) return;
    lastQuery = query;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    onStateChange({ status: "loading", query });
    void client.list(query, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && currentSequence === sequence && !controller.signal.aborted) {
          const parsed = AdminCustomersResponseSchema.safeParse(response);
          onStateChange(parsed.success ? { status: "success", query, response: parsed.data } : { status: "error", query, message: "Backend API вернул некорректный список клиентов" });
        }
      },
      (error: unknown) => {
        if (!disposed && currentSequence === sequence && !(error instanceof AdminCustomersClientError && error.kind === "aborted")) onStateChange({ status: "error", query, message: getAdminCustomersErrorMessage(error) });
      }
    );
  };
  return {
    load,
    retry: () => load(lastQuery),
    dispose: (): void => { if (disposed) return; disposed = true; sequence += 1; activeController?.abort(); activeController = null; }
  };
}
