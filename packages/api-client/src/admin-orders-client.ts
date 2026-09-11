import {
  AdminFulfillmentRecoveryResponseSchema,
  AdminOrderDetailSchema,
  AdminOrdersListResponseSchema,
  ApiErrorSchema,
  CancellationResponseSchema,
  IdempotencyKeySchema,
  type AdminFulfillmentRecoveryResponse,
  type AdminOrderDetail,
  type AdminOrdersListResponse,
  type CancellationOutcome,
  type AdminOrderStatus,
  type AdminPaymentFilter,
  type AdminFulfillmentStatus
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_ORDERS_TIMEOUT_MS = 10_000;

export type AdminOrdersClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "authentication"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "recovery_not_allowed"
  | "cancellation_not_allowed"
  | "already_canceled"
  | "refund_pending"
  | "reconciliation_required";

export class AdminOrdersClientError extends Error {
  readonly kind: AdminOrdersClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(kind: AdminOrdersClientErrorKind, message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminOrdersClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminOrdersClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}
export interface AdminOrdersRequestOptions { readonly signal?: AbortSignal }
export interface AdminOrdersQuery {
  readonly status?: AdminOrderStatus;
  readonly fulfillmentStatus?: AdminFulfillmentStatus;
  readonly paymentStatus?: AdminPaymentFilter;
  readonly from?: string;
  readonly to?: string;
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}
export interface AdminOrdersClient {
  list(query?: AdminOrdersQuery, options?: AdminOrdersRequestOptions): Promise<AdminOrdersListResponse>;
  get(orderId: number, options?: AdminOrdersRequestOptions): Promise<AdminOrderDetail>;
  retryFulfillment(orderId: number, options?: AdminOrdersRequestOptions): Promise<AdminFulfillmentRecoveryResponse>;
  cancelOrder(orderId: number, idempotencyKey: string, options?: AdminOrdersRequestOptions): Promise<AdminCancellationResponse>;
  reconcileRefund(orderId: number, idempotencyKey: string, options?: AdminOrdersRequestOptions): Promise<AdminCancellationResponse>;
}

export interface AdminCancellationResponse {
  readonly order: AdminOrderDetail;
  readonly outcome: CancellationOutcome;
}

function apiUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminOrdersClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function timeoutValue(value: number | undefined): number {
  const timeout = value ?? DEFAULT_ADMIN_ORDERS_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new AdminOrdersClientError("configuration", "Timeout Backend API настроен некорректно");
  return timeout;
}

function errorForResponse(status: number, body: unknown): AdminOrdersClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Admin API временно недоступен";
  const kind: AdminOrdersClientErrorKind = status === 401 ? "authentication" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 && code === "FULFILLMENT_RECOVERY_NOT_ALLOWED" ? "recovery_not_allowed" : status === 409 && code === "CANCELLATION_NOT_ALLOWED" ? "cancellation_not_allowed" : status === 409 && code === "ORDER_ALREADY_CANCELED" ? "already_canceled" : status === 409 && code === "REFUND_PENDING" ? "refund_pending" : status === 409 && code === "REFUND_RECONCILIATION_REQUIRED" ? "reconciliation_required" : status === 429 ? "rate_limited" : "http";
  return new AdminOrdersClientError(kind, message, code, status);
}

export function createAdminOrdersClient(options: AdminOrdersClientOptions): AdminOrdersClient {
  const baseUrl = apiUrl(options.apiUrl);
  const timeoutMs = timeoutValue(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(path: string, method: "GET" | "POST", schema: { safeParse(value: unknown): { success: boolean; data?: T } }, requestOptions: AdminOrdersRequestOptions, idempotencyKey?: string): Promise<T> {
    if (requestOptions.signal?.aborted === true) throw new AdminOrdersClientError("aborted", "Запрос к Backend API отменён");
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AdminOrdersClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => {
        controller.abort();
        reject(new AdminOrdersClientError("aborted", "Запрос к Backend API отменён"));
      };
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
    });
    const request = Promise.resolve().then(() => fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json", ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }) } : {}) },
      credentials: "include",
      signal: controller.signal,
      ...(method === "POST" ? { body: "{}" } : {})
    })).then(async (response) => {
      if (timedOut || requestOptions.signal?.aborted === true) throw new AdminOrdersClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let body: unknown;
      try { body = await response.json(); } catch { throw new AdminOrdersClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw errorForResponse(response.status, body);
      const parsed = schema.safeParse(body);
      if (!parsed.success || parsed.data === undefined) throw new AdminOrdersClientError("invalid_response", "Backend API вернул некорректный ответ");
      return parsed.data;
    });
    try {
      const races: Array<Promise<T>> = [request, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminOrdersClientError) throw error;
      if (timedOut) throw new AdminOrdersClientError("timeout", "Backend API не ответил вовремя");
      if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw new AdminOrdersClientError("aborted", "Запрос к Backend API отменён");
      throw new AdminOrdersClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }

  return {
    list(query = {}, requestOptions = {}) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
      return request(`/admin/orders${params.size === 0 ? "" : `?${params.toString()}`}`, "GET", AdminOrdersListResponseSchema, requestOptions);
    },
    get(orderId, requestOptions = {}) {
      if (!Number.isSafeInteger(orderId) || orderId < 1) throw new AdminOrdersClientError("validation", "Неверный номер заказа");
      return request(`/admin/orders/${encodeURIComponent(String(orderId))}`, "GET", AdminOrderDetailSchema, requestOptions);
    },
    retryFulfillment(orderId, requestOptions = {}) {
      if (!Number.isSafeInteger(orderId) || orderId < 1) throw new AdminOrdersClientError("validation", "Неверный номер заказа");
      return request(`/admin/orders/${encodeURIComponent(String(orderId))}/fulfillment/retry`, "POST", AdminFulfillmentRecoveryResponseSchema, requestOptions);
    },
    async cancelOrder(orderId, idempotencyKey, requestOptions = {}) {
      const parsedIdempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKey);
      if (!Number.isSafeInteger(orderId) || orderId < 1 || !parsedIdempotencyKey.success) throw new AdminOrdersClientError("validation", "Не удалось подготовить безопасную отмену");
      const response = await request(`/admin/orders/${encodeURIComponent(String(orderId))}/cancel`, "POST", CancellationResponseSchema, requestOptions, parsedIdempotencyKey.data);
      const order = AdminOrderDetailSchema.safeParse(response.order);
      if (!order.success) throw new AdminOrdersClientError("invalid_response", "Backend API вернул некорректный заказ");
      return { order: order.data, outcome: response.outcome };
    },
    async reconcileRefund(orderId, idempotencyKey, requestOptions = {}) {
      const parsedIdempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKey);
      if (!Number.isSafeInteger(orderId) || orderId < 1 || !parsedIdempotencyKey.success) throw new AdminOrdersClientError("validation", "Не удалось подготовить безопасную сверку");
      const response = await request(`/admin/orders/${encodeURIComponent(String(orderId))}/refund/reconcile`, "POST", CancellationResponseSchema, requestOptions, parsedIdempotencyKey.data);
      const order = AdminOrderDetailSchema.safeParse(response.order);
      if (!order.success) throw new AdminOrdersClientError("invalid_response", "Backend API вернул некорректный заказ");
      return { order: order.data, outcome: response.outcome };
    }
  };
}
