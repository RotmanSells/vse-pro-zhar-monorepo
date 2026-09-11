import type { OrderResponse } from "@vse-pro-zhar/contracts";

import {
  CancellationClientError,
  type CancellationClient
} from "./cancellation-client.js";

export type CancellationRequestState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly order: OrderResponse; readonly outcome: string }
  | { readonly status: "error"; readonly message: string; readonly kind: string };

export interface CancellationRequestController {
  cancel(orderId: number, idempotencyKey: string): void;
  dispose(): void;
}

export function getCancellationErrorMessage(error: unknown): string {
  return error instanceof CancellationClientError ? error.message : "Не удалось отменить заказ";
}

export function createCancellationRequestController(
  client: CancellationClient,
  onStateChange: (state: CancellationRequestState) => void
): CancellationRequestController {
  let disposed = false;
  let sequence = 0;
  let active: AbortController | null = null;
  return {
    cancel(orderId, idempotencyKey) {
      if (disposed) return;
      const current = ++sequence;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      onStateChange({ status: "loading" });
      void client.cancelOrder(orderId, { idempotencyKey, signal: controller.signal }).then(
        (result) => {
          if (!disposed && current === sequence && !controller.signal.aborted) onStateChange({ status: "success", order: result.order, outcome: result.outcome });
        },
        (error: unknown) => {
          if (disposed || current !== sequence || error instanceof CancellationClientError && error.kind === "aborted") return;
          onStateChange({ status: "error", message: getCancellationErrorMessage(error), kind: error instanceof CancellationClientError ? error.kind : "unknown" });
        }
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      active?.abort();
    }
  };
}
