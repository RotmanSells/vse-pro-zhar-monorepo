import {
  OrderCreateRequestSchema,
  OrderResponseSchema,
  OrdersListResponseSchema,
  type ApiErrorCode,
  type OrderCreateRequest,
  type OrderResponse,
  type OrdersListResponse
} from "@vse-pro-zhar/contracts";

import {
  OrderClientError,
  type OrderClient,
  type OrderClientErrorKind
} from "./orders-client.js";

export type OrderCreateRequestState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly order: OrderResponse }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: ApiErrorCode | null;
      readonly kind: OrderClientErrorKind | "unknown";
    };

export type OrdersListRequestState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly response: OrdersListResponse }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: ApiErrorCode | null;
      readonly kind: OrderClientErrorKind | "unknown";
    };

export type OrderDetailRequestState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly order: OrderResponse }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: ApiErrorCode | null;
      readonly kind: OrderClientErrorKind | "unknown";
    };

export interface OrderRequestController {
  create(input: unknown, idempotencyKey: string): void;
  retryCreate(): void;
  loadOrders(): void;
  retryOrders(): void;
  loadOrder(orderId: number): void;
  refreshOrder(orderId: number): void;
  refreshOrders(): void;
  dispose(): void;
}

export function getOrderErrorMessage(error: unknown): string {
  return error instanceof OrderClientError
    ? error.message
    : "Не удалось выполнить операцию с заказом";
}

function errorState(error: unknown) {
  return {
    message: getOrderErrorMessage(error),
    code: error instanceof OrderClientError ? error.code : null,
    kind: error instanceof OrderClientError ? error.kind : ("unknown" as const)
  };
}

export function createOrderRequestController(
  client: OrderClient,
  onCreateStateChange: (state: OrderCreateRequestState) => void,
  onListStateChange: (state: OrdersListRequestState) => void,
  onDetailStateChange: (state: OrderDetailRequestState) => void
): OrderRequestController {
  let disposed = false;
  let createSequence = 0;
  let listSequence = 0;
  let detailSequence = 0;
  let createController: AbortController | null = null;
  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let lastCreate: { input: OrderCreateRequest; idempotencyKey: string } | null = null;

  const create = (input: unknown, idempotencyKey: string): void => {
    if (disposed) return;
    const parsed = OrderCreateRequestSchema.safeParse(input);
    if (!parsed.success) {
      onCreateStateChange({
        status: "error",
        ...errorState(new OrderClientError("validation", "Проверьте состав заказа и самовывоз"))
      });
      return;
    }
    lastCreate = { input: parsed.data, idempotencyKey };
    const sequence = ++createSequence;
    createController?.abort();
    const controller = new AbortController();
    createController = controller;
    onCreateStateChange({ status: "loading" });
    void client.createOrder(parsed.data, { idempotencyKey, signal: controller.signal }).then(
      (order) => {
        if (!disposed && sequence === createSequence && !controller.signal.aborted) {
          const checked = OrderResponseSchema.safeParse(order);
          if (!checked.success) {
            onCreateStateChange({ status: "error", ...errorState(new OrderClientError("invalid_response", "Backend API вернул некорректный заказ")) });
          } else {
            onCreateStateChange({ status: "success", order: checked.data });
          }
        }
      },
      (error: unknown) => {
        if (disposed || sequence !== createSequence) return;
        if (controller.signal.aborted && error instanceof OrderClientError && error.kind === "aborted") return;
        onCreateStateChange({ status: "error", ...errorState(error) });
      }
    );
  };

  const loadOrders = (): void => {
    if (disposed) return;
    const sequence = ++listSequence;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    onListStateChange({ status: "loading" });
    void client.listOrders({ signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === listSequence && !controller.signal.aborted) {
          const checked = OrdersListResponseSchema.safeParse(response);
          onListStateChange(checked.success ? { status: "success", response: checked.data } : { status: "error", ...errorState(new OrderClientError("invalid_response", "Backend API вернул некорректный список заказов")) });
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === listSequence) onListStateChange({ status: "error", ...errorState(error) });
      }
    );
  };

  const loadOrder = (orderId: number): void => {
    if (disposed) return;
    const sequence = ++detailSequence;
    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    onDetailStateChange({ status: "loading" });
    void client.getOrder(orderId, { signal: controller.signal }).then(
      (order) => {
        if (!disposed && sequence === detailSequence && !controller.signal.aborted) {
          const checked = OrderResponseSchema.safeParse(order);
          onDetailStateChange(checked.success ? { status: "success", order: checked.data } : { status: "error", ...errorState(new OrderClientError("invalid_response", "Backend API вернул некорректный заказ")) });
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === detailSequence) onDetailStateChange({ status: "error", ...errorState(error) });
      }
    );
  };

  return {
    create,
    retryCreate: () => {
      if (lastCreate !== null) create(lastCreate.input, lastCreate.idempotencyKey);
    },
    loadOrders,
    retryOrders: loadOrders,
    loadOrder,
    refreshOrder: loadOrder,
    refreshOrders: loadOrders,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      createSequence += 1;
      listSequence += 1;
      detailSequence += 1;
      createController?.abort();
      listController?.abort();
      detailController?.abort();
    }
  };
}
