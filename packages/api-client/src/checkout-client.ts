import {
  ApiErrorSchema,
  CheckoutOptionsResponseSchema,
  CheckoutQuoteRequestSchema,
  CheckoutQuoteResponseSchema,
  type ApiErrorCode,
  type CheckoutOptionsResponse,
  type CheckoutQuoteRequest,
  type CheckoutQuoteResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";
import { cartQuoteMatchesItems } from "./cart.js";
import type { AuthSessionTransport } from "./auth-client.js";

export const DEFAULT_CHECKOUT_TIMEOUT_MS = 10_000;

export type CheckoutClientErrorKind =
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
  | "stale"
  | "rate_limited";

export class CheckoutClientError extends Error {
  readonly kind: CheckoutClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(
    kind: CheckoutClientErrorKind,
    message: string,
    code: ApiErrorCode | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "CheckoutClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface CheckoutClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface CheckoutRequestOptions {
  readonly signal?: AbortSignal;
}

export interface CheckoutClient {
  getCheckoutOptions(
    options?: CheckoutRequestOptions
  ): Promise<CheckoutOptionsResponse>;
  getCheckoutQuote(
    input: CheckoutQuoteRequest,
    options?: CheckoutRequestOptions
  ): Promise<CheckoutQuoteResponse>;
}

function invalidApiUrl(): CheckoutClientError {
  return new CheckoutClientError(
    "configuration",
    "Адрес Backend API настроен некорректно"
  );
}

function resolveApiUrl(value: string): string {
  if (value.trim() === "") throw invalidApiUrl();

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalidApiUrl();
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalidApiUrl();
  }

  return url.origin;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_CHECKOUT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new CheckoutClientError(
      "configuration",
      "Timeout Backend API настроен некорректно"
    );
  }
  return value;
}

function createAbortError(): CheckoutClientError {
  return new CheckoutClientError("aborted", "Запрос к Backend API отменён");
}

function createTimeoutError(): CheckoutClientError {
  return new CheckoutClientError("timeout", "Backend API не ответил вовремя");
}

function createInvalidResponseError(): CheckoutClientError {
  return new CheckoutClientError(
    "invalid_response",
    "Backend API вернул некорректный ответ"
  );
}

function createValidationError(): CheckoutClientError {
  return new CheckoutClientError("validation", "Проверьте данные оформления");
}

function errorKindForCode(code: ApiErrorCode): CheckoutClientErrorKind {
  switch (code) {
    case "AUTHENTICATION_ERROR":
      return "authentication";
    case "CART_ITEM_UNAVAILABLE":
      return "cart_unavailable";
    case "PICKUP_OPTION_UNAVAILABLE":
      return "pickup_unavailable";
    case "CHECKOUT_UNAVAILABLE":
      return "checkout_unavailable";
    case "CHECKOUT_STALE":
      return "stale";
    case "RATE_LIMITED":
      return "rate_limited";
    default:
      return "http";
  }
}

function getHttpError(status: number, body: unknown): CheckoutClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new CheckoutClientError(
      "http",
      "Оформление самовывоза временно недоступно",
      null,
      status
    );
  }

  const code = parsed.data.error.code;
  return new CheckoutClientError(
    errorKindForCode(code),
    parsed.data.error.message,
    code,
    status
  );
}

function matchesCheckoutQuote(
  request: CheckoutQuoteRequest,
  response: CheckoutQuoteResponse
): boolean {
  return (
    cartQuoteMatchesItems(request.items, response.items) &&
    response.pickup.location.id === request.pickup.locationId &&
    response.pickup.slot.id === request.pickup.slotId
  );
}

export function createCheckoutClient(
  options: CheckoutClientOptions
): CheckoutClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl =
    options.fetchImpl ??
    ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(
    path: "/checkout/options" | "/checkout/quote",
    input: unknown,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    requestOptions: CheckoutRequestOptions
  ): Promise<T> {
    if (path === "/checkout/quote") {
      const parsedInput = CheckoutQuoteRequestSchema.safeParse(input);
      if (!parsedInput.success) throw createValidationError();
    }

    const externalSignal = requestOptions.signal;
    if (externalSignal?.aborted === true) throw createAbortError();

    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(createTimeoutError());
      }, timeoutMs);
    });

    const abort =
      externalSignal === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            const handleAbort = (): void => {
              controller.abort();
              reject(createAbortError());
            };

            externalSignal.addEventListener("abort", handleAbort, {
              once: true
            });
            removeAbortListener = () => {
              externalSignal.removeEventListener("abort", handleAbort);
            };
          });

    const request = Promise.resolve()
      .then(async () => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...(await options.transport.getRequestHeaders())
        };
        if (path === "/checkout/quote") {
          headers["Content-Type"] = "application/json";
        }
        if (options.transport.mode === "bearer") {
          headers["X-Session-Transport"] = "bearer";
        }

        const init: RequestInit = {
          method: path === "/checkout/options" ? "GET" : "POST",
          headers,
          credentials: "include",
          signal: controller.signal
        };
        if (path === "/checkout/quote") {
          const parsedInput = CheckoutQuoteRequestSchema.safeParse(input);
          if (!parsedInput.success) throw createValidationError();
          init.body = JSON.stringify(parsedInput.data);
        }
        return fetchImpl(`${apiUrl}${path}`, init);
      })
      .then(async (response) => {
        if (timedOut || (externalSignal !== undefined && externalSignal.aborted)) {
          throw timedOut ? createTimeoutError() : createAbortError();
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw createInvalidResponseError();
        }

        if (timedOut || (externalSignal !== undefined && externalSignal.aborted)) {
          throw timedOut ? createTimeoutError() : createAbortError();
        }
        if (!response.ok) throw getHttpError(response.status, body);

        const parsed = schema.safeParse(body);
        if (!parsed.success || parsed.data === undefined) {
          throw createInvalidResponseError();
        }

        if (
          path === "/checkout/quote" &&
          !matchesCheckoutQuote(
            CheckoutQuoteRequestSchema.parse(input),
            parsed.data as CheckoutQuoteResponse
          )
        ) {
          throw createInvalidResponseError();
        }
        return parsed.data;
      });

    try {
      const races: Array<Promise<T>> = [request, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof CheckoutClientError) throw error;
      if (timedOut) throw createTimeoutError();
      if (externalSignal !== undefined && externalSignal.aborted) {
        throw createAbortError();
      }
      throw new CheckoutClientError(
        "network",
        "Не удалось связаться с Backend API"
      );
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbortListener?.();
    }
  }

  return {
    getCheckoutOptions: (requestOptions = {}) =>
      request(
        "/checkout/options",
        undefined,
        CheckoutOptionsResponseSchema,
        requestOptions
      ),
    getCheckoutQuote: (input, requestOptions = {}) =>
      request(
        "/checkout/quote",
        input,
        CheckoutQuoteResponseSchema,
        requestOptions
      )
  };
}
