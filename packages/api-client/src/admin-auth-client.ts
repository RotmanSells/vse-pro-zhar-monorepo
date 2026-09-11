import {
  AdminAuthLoginRequestSchema,
  AdminAuthLoginResponseSchema,
  AdminAuthLogoutResponseSchema,
  AdminAuthMeResponseSchema,
  ApiErrorSchema,
  type AdminAuthLoginRequest,
  type AdminAuthLoginResponse,
  type AdminAuthLogoutResponse,
  type AdminAuthMeResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_AUTH_TIMEOUT_MS = 10_000;

export type AdminAuthClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "rate_limited";

export class AdminAuthClientError extends Error {
  readonly kind: AdminAuthClientErrorKind;
  readonly status: number | null;

  constructor(kind: AdminAuthClientErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "AdminAuthClientError";
    this.kind = kind;
    this.status = status;
  }
}

export interface AdminAuthClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface AdminAuthRequestOptions { readonly signal?: AbortSignal }

export interface AdminAuthClient {
  login(input: AdminAuthLoginRequest, options?: AdminAuthRequestOptions): Promise<AdminAuthLoginResponse>;
  me(options?: AdminAuthRequestOptions): Promise<AdminAuthMeResponse>;
  logout(options?: AdminAuthRequestOptions): Promise<AdminAuthLogoutResponse>;
}

function resolveApiUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminAuthClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function resolveTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_ADMIN_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new AdminAuthClientError("configuration", "Timeout Backend API настроен некорректно");
  return timeout;
}

function httpError(status: number, body: unknown): AdminAuthClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const message = parsed.success ? parsed.data.error.message : "Admin API временно недоступен";
  const kind = status === 401 || status === 403 ? "authentication" : status === 429 ? "rate_limited" : "http";
  return new AdminAuthClientError(kind, message, status);
}

export function createAdminAuthClient(options: AdminAuthClientOptions): AdminAuthClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    requestOptions: AdminAuthRequestOptions
  ): Promise<T> {
    if (path === "/admin/auth/login" && !AdminAuthLoginRequestSchema.safeParse(body).success) throw new AdminAuthClientError("validation", "Проверьте логин и пароль");
    if (requestOptions.signal?.aborted === true) throw new AdminAuthClientError("aborted", "Запрос к Backend API отменён");
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AdminAuthClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => {
        controller.abort();
        reject(new AdminAuthClientError("aborted", "Запрос к Backend API отменён"));
      };
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
    });
    const request = Promise.resolve().then(() => fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      credentials: "include",
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })).then(async (response) => {
      if (timedOut || requestOptions.signal?.aborted === true) throw new AdminAuthClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let parsedBody: unknown;
      try { parsedBody = await response.json(); } catch { throw new AdminAuthClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw httpError(response.status, parsedBody);
      const parsed = schema.safeParse(parsedBody);
      if (!parsed.success || parsed.data === undefined) throw new AdminAuthClientError("invalid_response", "Backend API вернул некорректный ответ");
      return parsed.data;
    });
    try {
      const races: Array<Promise<T>> = [request, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminAuthClientError) throw error;
      if (timedOut) throw new AdminAuthClientError("timeout", "Backend API не ответил вовремя");
      if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw new AdminAuthClientError("aborted", "Запрос к Backend API отменён");
      throw new AdminAuthClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }

  return {
    login: (input, requestOptions = {}) => request("/admin/auth/login", "POST", input, AdminAuthLoginResponseSchema, requestOptions),
    me: (requestOptions = {}) => request("/admin/auth/me", "GET", undefined, AdminAuthMeResponseSchema, requestOptions),
    logout: (requestOptions = {}) => request("/admin/auth/logout", "POST", undefined, AdminAuthLogoutResponseSchema, requestOptions)
  };
}
