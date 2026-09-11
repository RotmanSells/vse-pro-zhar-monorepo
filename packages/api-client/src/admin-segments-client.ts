import {
  AdminSegmentCodeSchema,
  AdminSegmentPreviewQuerySchema,
  AdminSegmentPreviewResponseSchema,
  AdminSegmentsResponseSchema,
  ApiErrorSchema,
  type AdminSegmentCode,
  type AdminSegmentPreviewQueryInput,
  type AdminSegmentPreviewResponse,
  type AdminSegmentsResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_SEGMENTS_TIMEOUT_MS = 10_000;
export type AdminSegmentsClientErrorKind = "configuration" | "network" | "http" | "timeout" | "aborted" | "invalid_response" | "authentication" | "forbidden" | "validation" | "unavailable";

export class AdminSegmentsClientError extends Error {
  readonly kind: AdminSegmentsClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(kind: AdminSegmentsClientErrorKind, message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminSegmentsClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminSegmentsClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}
export interface AdminSegmentsRequestOptions { readonly signal?: AbortSignal }

export interface AdminSegmentsClient {
  list(options?: AdminSegmentsRequestOptions): Promise<AdminSegmentsResponse>;
  preview(code: AdminSegmentCode, query?: AdminSegmentPreviewQueryInput, options?: AdminSegmentsRequestOptions): Promise<AdminSegmentPreviewResponse>;
}

function baseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminSegmentsClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function timeoutValue(value: number | undefined): number {
  const timeout = value ?? DEFAULT_ADMIN_SEGMENTS_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new AdminSegmentsClientError("configuration", "Timeout Backend API настроен некорректно");
  return timeout;
}

function errorForResponse(status: number, body: unknown): AdminSegmentsClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Сегменты временно недоступны";
  if (status === 401) return new AdminSegmentsClientError("authentication", message, code, status);
  if (status === 403) return new AdminSegmentsClientError("forbidden", message, code, status);
  if (status === 400) return new AdminSegmentsClientError("validation", message, code, status);
  if (status === 503 || code === "SERVICE_UNAVAILABLE") return new AdminSegmentsClientError("unavailable", message, code, status);
  return new AdminSegmentsClientError("http", message, code, status);
}

export function createAdminSegmentsClient(options: AdminSegmentsClientOptions): AdminSegmentsClient {
  const url = baseUrl(options.apiUrl);
  const timeoutMs = timeoutValue(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(path: string, schema: { safeParse(value: unknown): { success: boolean; data?: T } }, requestOptions: AdminSegmentsRequestOptions): Promise<T> {
    if (requestOptions.signal?.aborted === true) throw new AdminSegmentsClientError("aborted", "Запрос к Backend API отменён");
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AdminSegmentsClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => {
        controller.abort();
        reject(new AdminSegmentsClientError("aborted", "Запрос к Backend API отменён"));
      };
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
    });
    const operation = Promise.resolve().then(() => fetchImpl(`${url}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      signal: controller.signal
    })).then(async (response) => {
      if (timedOut || requestOptions.signal?.aborted === true) throw new AdminSegmentsClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let body: unknown;
      try { body = await response.json(); } catch { throw new AdminSegmentsClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw errorForResponse(response.status, body);
      const parsed = schema.safeParse(body);
      if (!parsed.success || parsed.data === undefined) throw new AdminSegmentsClientError("invalid_response", "Backend API вернул некорректные сегменты");
      return parsed.data;
    });
    try {
      const races: Array<Promise<T>> = [operation, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminSegmentsClientError) throw error;
      if (timedOut) throw new AdminSegmentsClientError("timeout", "Backend API не ответил вовремя");
      if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw new AdminSegmentsClientError("aborted", "Запрос к Backend API отменён");
      throw new AdminSegmentsClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }

  return {
    list: (requestOptions = {}) => request("/admin/segments", AdminSegmentsResponseSchema, requestOptions),
    preview: (code, query = {}, requestOptions = {}) => {
      const parsedCode = AdminSegmentCodeSchema.safeParse(code);
      if (!parsedCode.success) throw new AdminSegmentsClientError("validation", "Код сегмента некорректен");
      const parsedQuery = AdminSegmentPreviewQuerySchema.safeParse(query);
      if (!parsedQuery.success) throw new AdminSegmentsClientError("validation", "Параметры preview сегмента некорректны");
      const params = new URLSearchParams({ limit: String(parsedQuery.data.limit), offset: String(parsedQuery.data.offset) });
      return request(`/admin/segments/${encodeURIComponent(parsedCode.data)}?${params.toString()}`, AdminSegmentPreviewResponseSchema, requestOptions);
    }
  };
}
