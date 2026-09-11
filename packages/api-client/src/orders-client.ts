import {
  ApiErrorSchema,
  CreatedOrderResponseSchema,
  IdempotencyKeySchema,
  OrderCreateRequestSchema,
  OrderResponseSchema,
  OrdersListResponseSchema,
  type ApiErrorCode,
  type CreatedOrderResponse,
  type OrderCreateRequest,
  type OrderResponse,
  type OrdersListResponse
} from "@vse-pro-zhar/contracts";

import type { AuthSessionTransport } from "./auth-client.js";
import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ORDER_TIMEOUT_MS = 10_000;

export type OrderClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "cart_unavailable"
  | "pickup_unavailable"
  | "checkout_unavailable"
  | "idempotency_conflict"
  | "not_found"
  | "rate_limited";

export class OrderClientError extends Error {
  readonly kind: OrderClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(
    kind: OrderClientErrorKind,
    message: string,
    code: ApiErrorCode | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "OrderClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface OrderClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface OrderRequestOptions {
  readonly signal?: AbortSignal;
}

export interface CreateOrderRequestOptions extends OrderRequestOptions {
  readonly idempotencyKey: string;
}

export interface OrderClient {
  createOrder(
    input: OrderCreateRequest,
    options: CreateOrderRequestOptions
  ): Promise<CreatedOrderResponse>;
  listOrders(options?: OrderRequestOptions): Promise<OrdersListResponse>;
  getOrder(orderId: number, options?: OrderRequestOptions): Promise<OrderResponse>;
}

function resolveApiUrl(value: string): string {
  if (value.trim() === "") {
    throw new OrderClientError("configuration", "Адрес Backend API настроен некорректно");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new OrderClientError("configuration", "Адрес Backend API настроен некорректно");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new OrderClientError("configuration", "Адрес Backend API настроен некорректно");
  }
  return url.origin;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_ORDER_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new OrderClientError("configuration", "Timeout Backend API настроен некорректно");
  }
  return value;
}

function errorKindForCode(code: ApiErrorCode): OrderClientErrorKind {
  switch (code) {
    case "AUTHENTICATION_ERROR":
      return "authentication";
    case "CART_ITEM_UNAVAILABLE":
      return "cart_unavailable";
    case "PICKUP_OPTION_UNAVAILABLE":
      return "pickup_unavailable";
    case "CHECKOUT_UNAVAILABLE":
      return "checkout_unavailable";
    case "IDEMPOTENCY_CONFLICT":
      return "idempotency_conflict";
    case "NOT_FOUND":
      return "not_found";
    case "RATE_LIMITED":
      return "rate_limited";
    default:
      return "http";
  }
}

function getHttpError(status: number, body: unknown): OrderClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new OrderClientError(
      "http",
      "Операция с заказом временно недоступна",
      null,
      status
    );
  }
  const code = parsed.data.error.code;
  return new OrderClientError(
    errorKindForCode(code),
    parsed.data.error.message,
    code,
    status
  );
}

export function createOrderClient(options: OrderClientOptions): OrderClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl =
    options.fetchImpl ??
    ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(
    path: string,
    method: "GET" | "POST",
    input: unknown,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    requestOptions: OrderRequestOptions,
    idempotencyKey?: string
  ): Promise<T> {
    if (path === "/orders" && method === "POST") {
      if (!OrderCreateRequestSchema.safeParse(input).success) {
        throw new OrderClientError("validation", "Проверьте состав заказа и самовывоз");
      }
      if (!IdempotencyKeySchema.safeParse(idempotencyKey).success) {
        throw new OrderClientError("validation", "Не удалось подготовить безопасный повтор запроса");
      }
    }
    const externalSignal = requestOptions.signal;
    if (externalSignal?.aborted === true) {
      throw new OrderClientError("aborted", "Запрос к Backend API отменён");
    }

    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new OrderClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort =
      externalSignal === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            const handleAbort = (): void => {
              controller.abort();
              reject(new OrderClientError("aborted", "Запрос к Backend API отменён"));
            };
            externalSignal.addEventListener("abort", handleAbort, { once: true });
            removeAbortListener = () => {
              externalSignal.removeEventListener("abort", handleAbort);
            };
          });

    const requestPromise = Promise.resolve()
      .then(async () => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...(await options.transport.getRequestHeaders())
        };
        if (options.transport.mode === "bearer") {
          headers["X-Session-Transport"] = "bearer";
        }
        if (method === "POST") {
          headers["Content-Type"] = "application/json";
          headers["Idempotency-Key"] = idempotencyKey as string;
        }
        const init: RequestInit = {
          method,
          headers,
          credentials: "include",
          signal: controller.signal
        };
        if (method === "POST") {
          init.body = JSON.stringify(OrderCreateRequestSchema.parse(input));
        }
        return fetchImpl(`${apiUrl}${path}`, init);
      })
      .then(async (response) => {
        if (timedOut || externalSignal?.aborted === true) {
          throw new OrderClientError(
            timedOut ? "timeout" : "aborted",
            timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён"
          );
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new OrderClientError("invalid_response", "Backend API вернул некорректный ответ");
        }
        if (!response.ok) throw getHttpError(response.status, body);
        const parsed = schema.safeParse(body);
        if (!parsed.success || parsed.data === undefined) {
          throw new OrderClientError("invalid_response", "Backend API вернул некорректный ответ");
        }
        return parsed.data;
      });

    try {
      const races: Array<Promise<T>> = [requestPromise, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof OrderClientError) throw error;
      if (timedOut) throw new OrderClientError("timeout", "Backend API не ответил вовремя");
      if (externalSignal !== undefined && externalSignal.aborted) {
        throw new OrderClientError("aborted", "Запрос к Backend API отменён");
      }
      throw new OrderClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbortListener?.();
    }
  }

  return {
    createOrder: (input, requestOptions) =>
      request(
        "/orders",
        "POST",
        input,
        CreatedOrderResponseSchema,
        requestOptions,
        requestOptions.idempotencyKey
      ),
    listOrders: (requestOptions = {}) =>
      request("/orders", "GET", undefined, OrdersListResponseSchema, requestOptions),
    getOrder: (orderId, requestOptions = {}) =>
      request(
        `/orders/${encodeURIComponent(String(orderId))}`,
        "GET",
        undefined,
        OrderResponseSchema,
        requestOptions
      )
  };
}
