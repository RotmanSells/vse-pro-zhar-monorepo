import {
  AdminAnalyticsExportResponseSchema,
  AdminAnalyticsQuerySchema,
  AdminAnalyticsResponseSchema,
  ApiErrorSchema,
  type AdminAnalyticsExportResponse,
  type AdminAnalyticsPeriod,
  type AdminAnalyticsResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_ANALYTICS_TIMEOUT_MS = 10_000;

export type AdminAnalyticsClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "authentication"
  | "forbidden"
  | "validation"
  | "unavailable";

export class AdminAnalyticsClientError extends Error {
  readonly kind: AdminAnalyticsClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(kind: AdminAnalyticsClientErrorKind, message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminAnalyticsClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminAnalyticsClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface AdminAnalyticsRequestOptions { readonly signal?: AbortSignal }
export interface AdminAnalyticsQuery { readonly days: AdminAnalyticsPeriod }

export interface AdminAnalyticsClient {
  get(query: AdminAnalyticsQuery, options?: AdminAnalyticsRequestOptions): Promise<AdminAnalyticsResponse>;
  exportCsv(query: AdminAnalyticsQuery, options?: AdminAnalyticsRequestOptions): Promise<AdminAnalyticsExportResponse>;
}

function apiUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminAnalyticsClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function timeoutValue(value: number | undefined): number {
  const timeout = value ?? DEFAULT_ADMIN_ANALYTICS_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new AdminAnalyticsClientError("configuration", "Timeout Backend API настроен некорректно");
  return timeout;
}

function errorForResponse(status: number, body: unknown): AdminAnalyticsClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Аналитика временно недоступна";
  if (status === 401) return new AdminAnalyticsClientError("authentication", message, code, status);
  if (status === 403) return new AdminAnalyticsClientError("forbidden", message, code, status);
  if (status === 503 || code === "SERVICE_UNAVAILABLE") return new AdminAnalyticsClientError("unavailable", message, code, status);
  return new AdminAnalyticsClientError("http", message, code, status);
}

export function createAdminAnalyticsClient(options: AdminAnalyticsClientOptions): AdminAnalyticsClient {
  const baseUrl = apiUrl(options.apiUrl);
  const timeoutMs = timeoutValue(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(
    path: string,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    requestOptions: AdminAnalyticsRequestOptions
  ): Promise<T> {
    if (requestOptions.signal?.aborted === true) throw new AdminAnalyticsClientError("aborted", "Запрос к Backend API отменён");
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AdminAnalyticsClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => {
        controller.abort();
        reject(new AdminAnalyticsClientError("aborted", "Запрос к Backend API отменён"));
      };
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
    });
    const operation = Promise.resolve().then(() => fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      signal: controller.signal
    })).then(async (response) => {
      if (timedOut || requestOptions.signal?.aborted === true) throw new AdminAnalyticsClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let body: unknown;
      try { body = await response.json(); } catch { throw new AdminAnalyticsClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw errorForResponse(response.status, body);
      const parsed = schema.safeParse(body);
      if (!parsed.success || parsed.data === undefined) throw new AdminAnalyticsClientError("invalid_response", "Backend API вернул некорректную аналитику");
      return parsed.data;
    });
    try {
      const races: Array<Promise<T>> = [operation, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminAnalyticsClientError) throw error;
      if (timedOut) throw new AdminAnalyticsClientError("timeout", "Backend API не ответил вовремя");
      if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw new AdminAnalyticsClientError("aborted", "Запрос к Backend API отменён");
      throw new AdminAnalyticsClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }

  function pathFor(query: AdminAnalyticsQuery, suffix = ""): string {
    const parsed = AdminAnalyticsQuerySchema.safeParse(query);
    if (!parsed.success) throw new AdminAnalyticsClientError("validation", "Период аналитики некорректен");
    return `/admin/analytics${suffix}?days=${encodeURIComponent(String(parsed.data.days))}`;
  }

  return {
    get: (query, requestOptions = {}) => request(pathFor(query), AdminAnalyticsResponseSchema, requestOptions),
    exportCsv: (query, requestOptions = {}) => request(pathFor(query, "/export"), AdminAnalyticsExportResponseSchema, requestOptions)
  };
}
