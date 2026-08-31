import {
  HealthResponseSchema,
  type HealthResponse
} from "@vse-pro-zhar/contracts";

export const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;

export type HealthClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response";

export class HealthClientError extends Error {
  readonly kind: HealthClientErrorKind;

  constructor(kind: HealthClientErrorKind, message: string) {
    super(message);
    this.name = "HealthClientError";
    this.kind = kind;
  }
}

export interface HealthClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface HealthRequestOptions {
  readonly signal?: AbortSignal;
}

export type FetchImplementation = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface HealthClient {
  getHealth(options?: HealthRequestOptions): Promise<HealthResponse>;
}

function invalidApiUrl(): HealthClientError {
  return new HealthClientError(
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
  const resolvedTimeout = timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

  if (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0) {
    throw new HealthClientError(
      "configuration",
      "Timeout Backend API настроен некорректно"
    );
  }

  return resolvedTimeout;
}

function createTimeoutError(): HealthClientError {
  return new HealthClientError(
    "timeout",
    "Backend API не ответил вовремя"
  );
}

function createAbortError(): HealthClientError {
  return new HealthClientError("aborted", "Запрос к Backend API отменён");
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

function createInvalidResponseError(): HealthClientError {
  return new HealthClientError(
    "invalid_response",
    "Backend API вернул некорректный ответ"
  );
}

export function createHealthClient(
  options: HealthClientOptions
): HealthClient {
  const fetchImpl =
    options.fetchImpl ??
    ((input: string, init?: RequestInit) => fetch(input, init));

  return {
    async getHealth(
      requestOptions: HealthRequestOptions = {}
    ): Promise<HealthResponse> {
      const apiUrl = resolveApiUrl(options.apiUrl);
      const timeoutMs = resolveTimeout(options.timeoutMs);
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

      let request: Promise<HealthResponse>;

      try {
        request = fetchImpl(`${apiUrl}/health`, {
          headers: { Accept: "application/json" },
          signal: requestController.signal
        }).then(async (response): Promise<HealthResponse> => {
          throwIfAborted(timedOut, externalSignal);

          if (!response.ok) {
            throw new HealthClientError(
              "http",
              "Backend API временно недоступен"
            );
          }

          let body: unknown;

          try {
            body = await response.json();
          } catch {
            throwIfAborted(timedOut, externalSignal);
            throw createInvalidResponseError();
          }

          throwIfAborted(timedOut, externalSignal);

          const parsed = HealthResponseSchema.safeParse(body);

          if (!parsed.success) {
            throw createInvalidResponseError();
          }

          return parsed.data;
        });
      } catch (error: unknown) {
        request = Promise.reject(error);
      }

      try {
        const races: Array<Promise<HealthResponse>> = [request, timeout];

        if (abort !== undefined) {
          races.push(abort);
        }

        return await Promise.race(races);
      } catch (error: unknown) {
        if (error instanceof HealthClientError) {
          throw error;
        }

        if (timedOut) {
          throw createTimeoutError();
        }

        if (externalSignal?.aborted) {
          throw createAbortError();
        }

        throw new HealthClientError(
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
