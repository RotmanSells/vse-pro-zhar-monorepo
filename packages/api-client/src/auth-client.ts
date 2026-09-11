import {
  ApiErrorSchema,
  CustomerIdentifyRequestSchema,
  CustomerIdentifyResponseSchema,
  CustomerLogoutResponseSchema,
  CustomerMeResponseSchema,
  type ApiErrorCode,
  type CustomerIdentifyRequest,
  type CustomerIdentifyResponse,
  type CustomerLogoutResponse,
  type CustomerMeResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_AUTH_TIMEOUT_MS = 10_000;

export type AuthClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "rate_limited";

export class AuthClientError extends Error {
  readonly kind: AuthClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(
    kind: AuthClientErrorKind,
    message: string,
    code: ApiErrorCode | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "AuthClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AuthSessionTransport {
  readonly mode: "cookie" | "bearer";
  getRequestHeaders(): Promise<Readonly<Record<string, string>>>;
  storeSession(token: string, expiresAt: string): Promise<void>;
  clearSession(): Promise<void>;
}

export interface AuthClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface AuthRequestOptions {
  readonly signal?: AbortSignal;
}

export interface AuthClient {
  identify(
    input: CustomerIdentifyRequest,
    options?: AuthRequestOptions
  ): Promise<CustomerIdentifyResponse>;
  me(options?: AuthRequestOptions): Promise<CustomerMeResponse>;
  logout(options?: AuthRequestOptions): Promise<CustomerLogoutResponse>;
}

function resolveApiUrl(value: string): string {
  if (value.trim() === "") throw new AuthClientError("configuration", "Адрес Backend API настроен некорректно");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AuthClientError("configuration", "Адрес Backend API настроен некорректно");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new AuthClientError("configuration", "Адрес Backend API настроен некорректно");
  }
  return url.origin;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new AuthClientError("configuration", "Timeout Backend API настроен некорректно");
  }
  return value;
}

function errorForStatus(status: number, body: unknown): AuthClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const message = parsed.success ? parsed.data.error.message : "Сервис идентификации временно недоступен";
  const code = parsed.success ? parsed.data.error.code : null;
  if (status === 401 || status === 403) return new AuthClientError("authentication", message, code, status);
  if (status === 429) return new AuthClientError("rate_limited", message, code, status);
  return new AuthClientError("http", message, code, status);
}

function abortError(): AuthClientError {
  return new AuthClientError("aborted", "Запрос к Backend API отменён");
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AuthClientError("invalid_response", "Backend API вернул некорректный ответ");
  }
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  let sessionOperation = 0;
  let sessionMutationQueue = Promise.resolve();

  function mutateSession(
    operation: number,
    mutation: () => Promise<void>
  ): Promise<void> {
    const queued = sessionMutationQueue.then(async () => {
      if (operation !== sessionOperation) return;
      await mutation();
    });
    sessionMutationQueue = queued.catch(() => undefined);
    return queued;
  }

  async function request<T>(
    path: string,
    method: "GET" | "POST",
    input: unknown,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    requestOptions: AuthRequestOptions,
    inputSchema?: { safeParse(value: unknown): { success: boolean; data?: unknown } }
  ): Promise<T> {
    const parsedInput = inputSchema === undefined || input === undefined ? undefined : inputSchema.safeParse(input);
    if (inputSchema !== undefined && (parsedInput === undefined || !parsedInput.success)) {
      throw new AuthClientError("validation", "Проверьте номер телефона и имя");
    }
    const externalSignal = requestOptions.signal;
    if (externalSignal?.aborted === true) throw abortError();

    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AuthClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort = externalSignal === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          const onAbort = (): void => {
            controller.abort();
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
        if (input !== undefined) headers["Content-Type"] = "application/json";
        if (options.transport.mode === "bearer") headers["X-Session-Transport"] = "bearer";
        const init: RequestInit = {
          method,
          headers,
          credentials: "include",
          signal: controller.signal
        };
        if (input !== undefined) {
          init.body = JSON.stringify(parsedInput?.success ? parsedInput.data : input);
        }
        return fetchImpl(`${apiUrl}${path}`, init);
      })
      .then(async (response) => {
        if (timedOut || externalSignal?.aborted === true) {
          throw timedOut ? new AuthClientError("timeout", "Backend API не ответил вовремя") : abortError();
        }
        const body = await parseBody(response);
        if (!response.ok) throw errorForStatus(response.status, body);
        const parsed = schema.safeParse(body);
        if (!parsed.success || parsed.data === undefined) {
          throw new AuthClientError("invalid_response", "Backend API вернул некорректный ответ");
        }
        return parsed.data;
      });

    try {
      const races: Array<Promise<T>> = [request, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AuthClientError) throw error;
      if (timedOut) throw new AuthClientError("timeout", "Backend API не ответил вовремя");
      if (externalSignal !== undefined && externalSignal.aborted) throw abortError();
      throw new AuthClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbortListener?.();
    }
  }

  return {
    async identify(input, requestOptions = {}) {
      const operation = ++sessionOperation;
      const response = await request(
        "/auth/identify",
        "POST",
        input,
        CustomerIdentifyResponseSchema,
        requestOptions,
        CustomerIdentifyRequestSchema
      );
      if (response.session.token !== null) {
        await mutateSession(operation, () =>
          options.transport.storeSession(
            response.session.token as string,
            response.session.expiresAt
          )
        );
      }
      return response;
    },
    async me(requestOptions = {}) {
      const operation = sessionOperation;
      try {
        return await request("/auth/me", "GET", undefined, CustomerMeResponseSchema, requestOptions);
      } catch (error: unknown) {
        if (error instanceof AuthClientError && error.kind === "authentication") {
          await mutateSession(operation, () => options.transport.clearSession());
        }
        throw error;
      }
    },
    async logout(requestOptions = {}) {
      const operation = ++sessionOperation;
      try {
        return await request("/auth/logout", "POST", undefined, CustomerLogoutResponseSchema, requestOptions);
      } finally {
        await mutateSession(operation, () => options.transport.clearSession());
      }
    }
  };
}
