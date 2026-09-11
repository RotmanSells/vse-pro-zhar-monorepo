import {
  ApiErrorSchema,
  CancellationResponseSchema,
  IdempotencyKeySchema,
  OrderResponseSchema,
  type ApiErrorCode,
  type CancellationOutcome,
  type OrderResponse
} from "@vse-pro-zhar/contracts";

import type { AuthSessionTransport } from "./auth-client.js";
import type { FetchImplementation } from "./health-client.js";

export type CancellationClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "not_found"
  | "not_allowed"
  | "already_canceled"
  | "refund_pending"
  | "reconciliation_required";

export class CancellationClientError extends Error {
  readonly kind: CancellationClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(kind: CancellationClientErrorKind, message: string, code: ApiErrorCode | null = null, status: number | null = null) {
    super(message);
    this.name = "CancellationClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface CancellationClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface CancellationRequestOptions {
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
}

export interface CancellationResponse {
  readonly order: OrderResponse;
  readonly outcome: CancellationOutcome;
}

export interface CancellationClient {
  cancelOrder(orderId: number, options: CancellationRequestOptions): Promise<CancellationResponse>;
}

function resolveUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new CancellationClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function errorKind(code: ApiErrorCode): CancellationClientErrorKind {
  switch (code) {
    case "AUTHENTICATION_ERROR": return "authentication";
    case "NOT_FOUND": return "not_found";
    case "CANCELLATION_NOT_ALLOWED": return "not_allowed";
    case "ORDER_ALREADY_CANCELED": return "already_canceled";
    case "REFUND_PENDING": return "refund_pending";
    case "REFUND_RECONCILIATION_REQUIRED": return "reconciliation_required";
    default: return "http";
  }
}

function responseError(status: number, body: unknown): CancellationClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (!parsed.success) return new CancellationClientError("http", "Отмена заказа временно недоступна", null, status);
  const code = parsed.data.error.code;
  return new CancellationClientError(errorKind(code), parsed.data.error.message, code, status);
}

export function createCancellationClient(options: CancellationClientOptions): CancellationClient {
  const apiUrl = resolveUrl(options.apiUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new CancellationClientError("configuration", "Timeout Backend API настроен некорректно");
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  return {
    async cancelOrder(orderId, requestOptions) {
      const parsedIdempotencyKey = IdempotencyKeySchema.safeParse(requestOptions.idempotencyKey);
      if (!Number.isSafeInteger(orderId) || orderId < 1 || !parsedIdempotencyKey.success) {
        throw new CancellationClientError("validation", "Не удалось подготовить безопасную отмену");
      }
      if (requestOptions.signal?.aborted === true) throw new CancellationClientError("aborted", "Запрос к Backend API отменён");
      const controller = new AbortController();
      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let removeAbort: (() => void) | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new CancellationClientError("timeout", "Backend API не ответил вовремя"));
        }, timeoutMs);
      });
      const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
        const onAbort = (): void => {
          controller.abort();
          reject(new CancellationClientError("aborted", "Запрос к Backend API отменён"));
        };
        requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
      });
      const request = Promise.resolve()
        .then(async () => fetchImpl(`${apiUrl}/orders/${encodeURIComponent(String(orderId))}/cancel`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": parsedIdempotencyKey.data,
            ...(await options.transport.getRequestHeaders()),
            ...(options.transport.mode === "bearer" ? { "X-Session-Transport": "bearer" } : {})
          },
          body: "{}",
          credentials: "include",
          signal: controller.signal
        }))
        .then(async (response) => {
          if (timedOut || requestOptions.signal?.aborted === true) throw new CancellationClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
          let body: unknown;
          try { body = await response.json(); } catch { throw new CancellationClientError("invalid_response", "Backend API вернул некорректный ответ"); }
          if (!response.ok) throw responseError(response.status, body);
          const envelope = CancellationResponseSchema.safeParse(body);
          if (!envelope.success) throw new CancellationClientError("invalid_response", "Backend API вернул некорректный ответ");
          const order = OrderResponseSchema.safeParse(envelope.data.order);
          if (!order.success) throw new CancellationClientError("invalid_response", "Backend API вернул некорректный заказ");
          return { order: order.data, outcome: envelope.data.outcome };
        });
      try {
        const races: Array<Promise<CancellationResponse>> = [request, timeout];
        if (abort !== undefined) races.push(abort);
        return await Promise.race(races);
      } catch (error: unknown) {
        if (error instanceof CancellationClientError) throw error;
        if (timedOut) throw new CancellationClientError("timeout", "Backend API не ответил вовремя");
        throw new CancellationClientError("network", "Не удалось связаться с Backend API");
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        removeAbort?.();
      }
    }
  };
}
