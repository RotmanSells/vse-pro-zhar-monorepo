import {
  ApiErrorSchema,
  IdempotencyKeySchema,
  PaymentCreateRequestSchema,
  PaymentCreateResponseSchema,
  PaymentStateResponseSchema,
  type ApiErrorCode,
  type PaymentCreateResponse,
  type PaymentStateResponse
} from "@vse-pro-zhar/contracts";

import type { AuthSessionTransport } from "./auth-client.js";
import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_PAYMENT_TIMEOUT_MS = 10_000;

export type PaymentClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "not_found"
  | "payment_not_allowed"
  | "payment_unavailable"
  | "payment_invalid"
  | "idempotency_conflict"
  | "rate_limited";

export class PaymentClientError extends Error {
  readonly kind: PaymentClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(
    kind: PaymentClientErrorKind,
    message: string,
    code: ApiErrorCode | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "PaymentClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface PaymentClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface PaymentRequestOptions {
  readonly signal?: AbortSignal;
}

export interface CreatePaymentRequestOptions extends PaymentRequestOptions {
  readonly idempotencyKey: string;
}

export interface PaymentClient {
  createPayment(
    orderId: number,
    options: CreatePaymentRequestOptions
  ): Promise<PaymentCreateResponse>;
  getPayment(
    orderId: number,
    options?: PaymentRequestOptions
  ): Promise<PaymentStateResponse>;
}

function resolveApiUrl(value: string): string {
  if (value.trim() === "") {
    throw new PaymentClientError("configuration", "Адрес Backend API настроен некорректно");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new PaymentClientError("configuration", "Адрес Backend API настроен некорректно");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new PaymentClientError("configuration", "Адрес Backend API настроен некорректно");
  }
  return url.origin;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_PAYMENT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new PaymentClientError("configuration", "Timeout Backend API настроен некорректно");
  }
  return value;
}

function errorKindForCode(code: ApiErrorCode): PaymentClientErrorKind {
  switch (code) {
    case "AUTHENTICATION_ERROR":
      return "authentication";
    case "NOT_FOUND":
      return "not_found";
    case "PAYMENT_NOT_ALLOWED":
      return "payment_not_allowed";
    case "PAYMENT_UNAVAILABLE":
      return "payment_unavailable";
    case "PAYMENT_INVALID":
      return "payment_invalid";
    case "IDEMPOTENCY_CONFLICT":
      return "idempotency_conflict";
    case "RATE_LIMITED":
      return "rate_limited";
    default:
      return "http";
  }
}

function getHttpError(status: number, body: unknown): PaymentClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new PaymentClientError(
      "http",
      "Оплата временно недоступна",
      null,
      status
    );
  }
  const code = parsed.data.error.code;
  return new PaymentClientError(
    errorKindForCode(code),
    parsed.data.error.message,
    code,
    status
  );
}

export function createPaymentClient(options: PaymentClientOptions): PaymentClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(
    path: string,
    method: "GET" | "POST",
    orderId: number,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    requestOptions: PaymentRequestOptions,
    idempotencyKey?: string
  ): Promise<T> {
    if (!Number.isSafeInteger(orderId) || orderId < 1) {
      throw new PaymentClientError("validation", "Номер заказа некорректен");
    }
    if (method === "POST") {
      if (!IdempotencyKeySchema.safeParse(idempotencyKey).success) {
        throw new PaymentClientError("validation", "Не удалось подготовить повтор оплаты");
      }
      if (!PaymentCreateRequestSchema.safeParse({}).success) {
        throw new PaymentClientError("validation", "Не удалось подготовить оплату");
      }
    }

    const externalSignal = requestOptions.signal;
    if (externalSignal?.aborted === true) {
      throw new PaymentClientError("aborted", "Запрос к Backend API отменён");
    }

    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new PaymentClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort =
      externalSignal === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            const handleAbort = (): void => {
              controller.abort();
              reject(new PaymentClientError("aborted", "Запрос к Backend API отменён"));
            };
            externalSignal.addEventListener("abort", handleAbort, { once: true });
            removeAbortListener = () => externalSignal.removeEventListener("abort", handleAbort);
          });

    const requestPromise = Promise.resolve()
      .then(async () => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...(await options.transport.getRequestHeaders())
        };
        if (options.transport.mode === "bearer") headers["X-Session-Transport"] = "bearer";
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
        if (method === "POST") init.body = JSON.stringify(PaymentCreateRequestSchema.parse({}));
        return fetchImpl(`${apiUrl}${path}`, init);
      })
      .then(async (response) => {
        if (timedOut || externalSignal?.aborted === true) {
          throw new PaymentClientError(
            timedOut ? "timeout" : "aborted",
            timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён"
          );
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new PaymentClientError("invalid_response", "Backend API вернул некорректный ответ");
        }
        if (!response.ok) throw getHttpError(response.status, body);
        const parsed = schema.safeParse(body);
        if (!parsed.success || parsed.data === undefined) {
          throw new PaymentClientError("invalid_response", "Backend API вернул некорректный ответ");
        }
        return parsed.data;
      });

    try {
      const races: Array<Promise<T>> = [requestPromise, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof PaymentClientError) throw error;
      if (timedOut) throw new PaymentClientError("timeout", "Backend API не ответил вовремя");
      if (externalSignal !== undefined && externalSignal.aborted) {
        throw new PaymentClientError("aborted", "Запрос к Backend API отменён");
      }
      throw new PaymentClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbortListener?.();
    }
  }

  return {
    createPayment: (orderId, requestOptions) =>
      request(
        `/orders/${encodeURIComponent(String(orderId))}/payments`,
        "POST",
        orderId,
        PaymentCreateResponseSchema,
        requestOptions,
        requestOptions.idempotencyKey
      ),
    getPayment: (orderId, requestOptions = {}) =>
      request(
        `/orders/${encodeURIComponent(String(orderId))}/payment`,
        "GET",
        orderId,
        PaymentStateResponseSchema,
        requestOptions
      )
  };
}
