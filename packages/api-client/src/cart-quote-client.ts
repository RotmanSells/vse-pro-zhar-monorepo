import {
  ApiErrorSchema,
  CartQuoteRequestSchema,
  CartQuoteResponseSchema,
  type ApiErrorCode,
  type CartQuoteRequest,
  type CartQuoteResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";
import { cartQuoteMatchesItems } from "./cart.js";

export const DEFAULT_CART_QUOTE_TIMEOUT_MS = 10_000;

export type CartQuoteClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation";

export class CartQuoteClientError extends Error {
  readonly kind: CartQuoteClientErrorKind;
  readonly code: ApiErrorCode | null;

  constructor(
    kind: CartQuoteClientErrorKind,
    message: string,
    code: ApiErrorCode | null = null
  ) {
    super(message);
    this.name = "CartQuoteClientError";
    this.kind = kind;
    this.code = code;
  }
}

export interface CartQuoteClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface CartQuoteRequestOptions {
  readonly signal?: AbortSignal;
}

export interface CartQuoteClient {
  getCartQuote(
    input: CartQuoteRequest,
    options?: CartQuoteRequestOptions
  ): Promise<CartQuoteResponse>;
}

function invalidApiUrl(): CartQuoteClientError {
  return new CartQuoteClientError(
    "configuration",
    "Адрес Backend API настроен некорректно"
  );
}

function resolveApiUrl(value: string): string {
  if (value.trim() === "") {
    throw invalidApiUrl();
  }

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
  const resolvedTimeout = timeoutMs ?? DEFAULT_CART_QUOTE_TIMEOUT_MS;

  if (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0) {
    throw new CartQuoteClientError(
      "configuration",
      "Timeout Backend API настроен некорректно"
    );
  }

  return resolvedTimeout;
}

function createTimeoutError(): CartQuoteClientError {
  return new CartQuoteClientError("timeout", "Backend API не ответил вовремя");
}

function createAbortError(): CartQuoteClientError {
  return new CartQuoteClientError("aborted", "Запрос к Backend API отменён");
}

function throwIfAborted(
  timedOut: boolean,
  signal: AbortSignal | undefined
): void {
  if (timedOut) {
    throw createTimeoutError();
  }

  if (signal?.aborted === true) {
    throw createAbortError();
  }
}

function createInvalidResponseError(): CartQuoteClientError {
  return new CartQuoteClientError(
    "invalid_response",
    "Backend API вернул некорректный ответ"
  );
}

function createValidationError(): CartQuoteClientError {
  return new CartQuoteClientError("validation", "Проверьте данные корзины");
}

function getHttpError(body: unknown): CartQuoteClientError {
  const parsed = ApiErrorSchema.safeParse(body);

  if (!parsed.success) {
    return new CartQuoteClientError("http", "Корзина временно недоступна");
  }

  return new CartQuoteClientError(
    "http",
    parsed.data.error.message,
    parsed.data.error.code
  );
}

export function createCartQuoteClient(
  options: CartQuoteClientOptions
): CartQuoteClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl =
    options.fetchImpl ??
    ((input: string, init?: RequestInit) => fetch(input, init));

  return {
    async getCartQuote(
      input,
      requestOptions: CartQuoteRequestOptions = {}
    ): Promise<CartQuoteResponse> {
      const parsedInput = CartQuoteRequestSchema.safeParse(input);
      if (!parsedInput.success) {
        throw createValidationError();
      }

      const externalSignal = requestOptions.signal;
      if (externalSignal?.aborted === true) {
        throw createAbortError();
      }

      const requestController = new AbortController();
      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let removeAbortListener: (() => void) | undefined;

      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          requestController.abort();
          reject(createTimeoutError());
        }, timeoutMs);
      });

      const abort =
        externalSignal === undefined
          ? undefined
          : new Promise<never>((_, reject) => {
              const handleAbort = (): void => {
                requestController.abort();
                reject(createAbortError());
              };

              if (externalSignal.aborted) {
                handleAbort();
                return;
              }

              externalSignal.addEventListener("abort", handleAbort, {
                once: true
              });
              removeAbortListener = () => {
                externalSignal.removeEventListener("abort", handleAbort);
              };
            });

      const request = Promise.resolve()
        .then(() =>
          fetchImpl(`${apiUrl}/cart/quote`, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json"
            },
            body: JSON.stringify(parsedInput.data),
            signal: requestController.signal
          })
        )
        .then(async (response): Promise<CartQuoteResponse> => {
          throwIfAborted(timedOut, externalSignal);

          let responseBody: unknown;
          try {
            responseBody = await response.json();
          } catch {
            throwIfAborted(timedOut, externalSignal);
            throw createInvalidResponseError();
          }

          throwIfAborted(timedOut, externalSignal);

          if (!response.ok) {
            throw getHttpError(responseBody);
          }

          const parsedResponse = CartQuoteResponseSchema.safeParse(responseBody);
          if (!parsedResponse.success) {
            throw createInvalidResponseError();
          }

          if (
            !cartQuoteMatchesItems(parsedInput.data.items, parsedResponse.data.items)
          ) {
            throw createInvalidResponseError();
          }

          return parsedResponse.data;
        });

      try {
        const races: Array<Promise<CartQuoteResponse>> = [request, timeout];
        if (abort !== undefined) {
          races.push(abort);
        }

        return await Promise.race(races);
      } catch (error: unknown) {
        if (error instanceof CartQuoteClientError) {
          throw error;
        }

        if (timedOut) {
          throw createTimeoutError();
        }

        if (externalSignal?.aborted) {
          throw createAbortError();
        }

        throw new CartQuoteClientError(
          "network",
          "Не удалось связаться с Backend API"
        );
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        removeAbortListener?.();
      }
    }
  };
}
