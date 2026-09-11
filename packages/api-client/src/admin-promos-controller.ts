import type { AdminPromosQueryInput, AdminPromosResponse } from "@vse-pro-zhar/contracts";

import { AdminPromosClientError, type AdminPromosClient } from "./admin-promos-client.js";

export type AdminPromosState =
  | { readonly status: "loading"; readonly query: AdminPromosQueryInput }
  | { readonly status: "success"; readonly query: AdminPromosQueryInput; readonly response: AdminPromosResponse }
  | { readonly status: "error"; readonly query: AdminPromosQueryInput; readonly message: string };

export interface AdminPromosRequestController {
  load(query?: AdminPromosQueryInput): void;
  retry(): void;
  dispose(): void;
}
export function getAdminPromosErrorMessage(error: unknown): string {
  return error instanceof AdminPromosClientError ? error.message : "Не удалось загрузить промокоды";
}

export function createAdminPromosRequestController(client: AdminPromosClient, onStateChange: (state: AdminPromosState) => void): AdminPromosRequestController {
  let disposed = false;
  let sequence = 0;
  let lastQuery: AdminPromosQueryInput = { limit: 50, offset: 0, search: "" };
  let activeController: AbortController | null = null;
  const load = (query: AdminPromosQueryInput = lastQuery): void => {
    if (disposed) return;
    lastQuery = query;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    onStateChange({ status: "loading", query });
    void client.list(query, { signal: controller.signal }).then(
      (response) => { if (!disposed && currentSequence === sequence && !controller.signal.aborted) onStateChange({ status: "success", query, response }); },
      (error: unknown) => { if (!disposed && currentSequence === sequence && !(error instanceof AdminPromosClientError && error.kind === "aborted")) onStateChange({ status: "error", query, message: getAdminPromosErrorMessage(error) }); }
    );
  };
  return {
    load,
    retry: () => load(lastQuery),
    dispose: (): void => { if (disposed) return; disposed = true; sequence += 1; activeController?.abort(); activeController = null; }
  };
}
