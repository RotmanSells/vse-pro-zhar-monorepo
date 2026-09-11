import {
  ApiErrorSchema,
  CustomerProfileResponseSchema,
  type ApiErrorCode,
  type CustomerProfileResponse
} from "@vse-pro-zhar/contracts";

import type { AuthSessionTransport } from "./auth-client.js";
import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_PROFILE_TIMEOUT_MS = 10_000;

export type ProfileClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "authentication"
  | "unavailable"
  | "rate_limited";

export class ProfileClientError extends Error {
  readonly kind: ProfileClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(
    kind: ProfileClientErrorKind,
    message: string,
    code: ApiErrorCode | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "ProfileClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface ProfileClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface ProfileRequestOptions {
  readonly signal?: AbortSignal;
}

export interface ProfileClient {
  getProfile(options?: ProfileRequestOptions): Promise<CustomerProfileResponse>;
}

function resolveApiUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) throw new Error();
    return url.origin;
  } catch {
    throw new ProfileClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function resolveTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_PROFILE_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new ProfileClientError("configuration", "Timeout Backend API настроен некорректно");
  }
  return timeout;
}

function errorForResponse(status: number, body: unknown): ProfileClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Профиль временно недоступен";
  if (status === 401 || status === 403) return new ProfileClientError("authentication", message, code, status);
  if (status === 429) return new ProfileClientError("rate_limited", message, code, status);
  if (status === 503) return new ProfileClientError("unavailable", message, code, status);
  return new ProfileClientError("http", message, code, status);
}

function abortError(): ProfileClientError {
  return new ProfileClientError("aborted", "Запрос к Backend API отменён");
}

export function createProfileClient(options: ProfileClientOptions): ProfileClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  return {
    async getProfile(requestOptions = {}): Promise<CustomerProfileResponse> {
      const externalSignal = requestOptions.signal;
      if (externalSignal?.aborted === true) throw abortError();

      const requestController = new AbortController();
      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let removeAbortListener: (() => void) | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          requestController.abort();
          reject(new ProfileClientError("timeout", "Backend API не ответил вовремя"));
        }, timeoutMs);
      });
      const abort = externalSignal === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            const onAbort = (): void => {
              requestController.abort();
              reject(abortError());
            };
            externalSignal.addEventListener("abort", onAbort, { once: true });
            removeAbortListener = () => externalSignal.removeEventListener("abort", onAbort);
          });
      const request = Promise.resolve()
        .then(async () => {
          const headers: Record<string, string> = {
            Accept: "application/json",
            ...(await options.transport.getRequestHeaders())
          };
          if (options.transport.mode === "bearer") headers["X-Session-Transport"] = "bearer";
          return fetchImpl(`${apiUrl}/profile`, {
            method: "GET",
            headers,
            credentials: "include",
            signal: requestController.signal
          });
        })
        .then(async (response) => {
          if (timedOut || externalSignal?.aborted === true) {
            throw timedOut ? new ProfileClientError("timeout", "Backend API не ответил вовремя") : abortError();
          }
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            throw new ProfileClientError("invalid_response", "Backend API вернул некорректный ответ");
          }
          if (!response.ok) throw errorForResponse(response.status, body);
          const parsed = CustomerProfileResponseSchema.safeParse(body);
          if (!parsed.success) throw new ProfileClientError("invalid_response", "Backend API вернул некорректный профиль");
          return parsed.data;
        });

      try {
        const races: Array<Promise<CustomerProfileResponse>> = [request, timeout];
        if (abort !== undefined) races.push(abort);
        return await Promise.race(races);
      } catch (error: unknown) {
        if (error instanceof ProfileClientError) throw error;
        if (timedOut) throw new ProfileClientError("timeout", "Backend API не ответил вовремя");
        if (externalSignal?.aborted) throw abortError();
        throw new ProfileClientError("network", "Не удалось связаться с Backend API");
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        removeAbortListener?.();
      }
    }
  };
}
