import {
  AdminFulfillmentRecoveryResponseSchema,
  AdminOrderDetailSchema,
  AdminOrdersListResponseSchema,
  type AdminFulfillmentRecoveryResponse,
  type AdminOrderDetail,
  type AdminOrdersListResponse
} from "@vse-pro-zhar/contracts";

import { AdminOrdersClientError, type AdminCancellationResponse, type AdminOrdersClient, type AdminOrdersQuery } from "./admin-orders-client.js";

export type AdminOrdersListState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: AdminOrdersListResponse }
  | { readonly status: "error"; readonly message: string };
export type AdminOrderDetailState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly order: AdminOrderDetail }
  | { readonly status: "error"; readonly message: string };
export type AdminRecoveryState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: AdminFulfillmentRecoveryResponse }
  | { readonly status: "error"; readonly message: string };
export type AdminCancellationState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: AdminCancellationResponse }
  | { readonly status: "error"; readonly message: string };

export interface AdminOrdersRequestController {
  loadOrders(query?: AdminOrdersQuery): void;
  retryOrders(): void;
  loadOrder(orderId: number): void;
  refreshOrder(): void;
  retryFulfillment(orderId: number): void;
  cancelOrder(orderId: number, idempotencyKey: string): void;
  reconcileRefund(orderId: number, idempotencyKey: string): void;
  dispose(): void;
}

export function getAdminOrdersErrorMessage(error: unknown): string {
  return error instanceof AdminOrdersClientError ? error.message : "Не удалось выполнить операцию с заказом";
}

export function createAdminOrdersRequestController(
  client: AdminOrdersClient,
  onList: (state: AdminOrdersListState) => void,
  onDetail: (state: AdminOrderDetailState) => void,
  onRecovery: (state: AdminRecoveryState) => void,
  onCancellation: (state: AdminCancellationState) => void = () => undefined
): AdminOrdersRequestController {
  let disposed = false;
  let listSequence = 0;
  let detailSequence = 0;
  let recoverySequence = 0;
  let cancellationSequence = 0;
  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let recoveryController: AbortController | null = null;
  let cancellationController: AbortController | null = null;
  let lastQuery: AdminOrdersQuery = {};
  let lastOrderId: number | null = null;
  const loadOrders = (query: AdminOrdersQuery = lastQuery): void => {
    if (disposed) return;
    lastQuery = query;
    const sequence = ++listSequence;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    onList({ status: "loading" });
    void client.list(query, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === listSequence && !controller.signal.aborted) {
          const parsed = AdminOrdersListResponseSchema.safeParse(response);
          onList(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректный список заказов" });
        }
      },
      (error: unknown) => { if (!disposed && sequence === listSequence && !(error instanceof AdminOrdersClientError && error.kind === "aborted")) onList({ status: "error", message: getAdminOrdersErrorMessage(error) }); }
    );
  };
  const loadOrder = (orderId: number): void => {
    if (disposed) return;
    lastOrderId = orderId;
    const sequence = ++detailSequence;
    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    onDetail({ status: "loading" });
    void client.get(orderId, { signal: controller.signal }).then(
      (order) => {
        if (!disposed && sequence === detailSequence && !controller.signal.aborted) {
          const parsed = AdminOrderDetailSchema.safeParse(order);
          onDetail(parsed.success ? { status: "success", order: parsed.data } : { status: "error", message: "Backend API вернул некорректный заказ" });
        }
      },
      (error: unknown) => { if (!disposed && sequence === detailSequence && !(error instanceof AdminOrdersClientError && error.kind === "aborted")) onDetail({ status: "error", message: getAdminOrdersErrorMessage(error) }); }
    );
  };
  const retryFulfillment = (orderId: number): void => {
    if (disposed) return;
    const sequence = ++recoverySequence;
    recoveryController?.abort();
    const controller = new AbortController();
    recoveryController = controller;
    onRecovery({ status: "loading" });
    void client.retryFulfillment(orderId, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === recoverySequence && !controller.signal.aborted) {
          const parsed = AdminFulfillmentRecoveryResponseSchema.safeParse(response);
          onRecovery(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректный ответ recovery" });
          if (parsed.success) loadOrder(orderId);
        }
      },
      (error: unknown) => { if (!disposed && sequence === recoverySequence && !(error instanceof AdminOrdersClientError && error.kind === "aborted")) onRecovery({ status: "error", message: getAdminOrdersErrorMessage(error) }); }
    );
  };
  const runCancellation = (orderId: number, idempotencyKey: string, reconcile: boolean): void => {
    if (disposed) return;
    const sequence = ++cancellationSequence;
    cancellationController?.abort();
    const controller = new AbortController();
    cancellationController = controller;
    onCancellation({ status: "loading" });
    const request = reconcile
      ? client.reconcileRefund(orderId, idempotencyKey, { signal: controller.signal })
      : client.cancelOrder(orderId, idempotencyKey, { signal: controller.signal });
    void request.then(
      (response) => {
        if (!disposed && sequence === cancellationSequence && !controller.signal.aborted) {
          onCancellation({ status: "success", response });
          loadOrder(orderId);
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === cancellationSequence && !(error instanceof AdminOrdersClientError && error.kind === "aborted")) onCancellation({ status: "error", message: getAdminOrdersErrorMessage(error) });
      }
    );
  };
  return {
    loadOrders,
    retryOrders: () => loadOrders(lastQuery),
    loadOrder,
    refreshOrder: () => { if (lastOrderId !== null) loadOrder(lastOrderId); },
    retryFulfillment,
    cancelOrder: (orderId, idempotencyKey) => runCancellation(orderId, idempotencyKey, false),
    reconcileRefund: (orderId, idempotencyKey) => runCancellation(orderId, idempotencyKey, true),
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      listSequence += 1;
      detailSequence += 1;
      recoverySequence += 1;
      cancellationSequence += 1;
      listController?.abort();
      detailController?.abort();
      recoveryController?.abort();
      cancellationController?.abort();
    }
  };
}
