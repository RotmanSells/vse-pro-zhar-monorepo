import {
  AdminPromoCreateRequestSchema,
  AdminPromoResponseSchema,
  AdminPromoRedemptionsQuerySchema,
  AdminPromoRedemptionsResponseSchema,
  AdminPromosQuerySchema,
  AdminPromosResponseSchema,
  AdminPromoUpdateRequestSchema,
  ApiErrorSchema,
  type AdminPromo,
  type AdminPromoCreateRequest,
  type AdminPromosQueryInput,
  type AdminPromosResponse,
  type AdminPromoRedemptionsQueryInput,
  type AdminPromoRedemptionsResponse,
  type AdminPromoUpdateRequest
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_PROMOS_TIMEOUT_MS = 10_000;
export type AdminPromosClientErrorKind = "configuration" | "network" | "http" | "timeout" | "aborted" | "invalid_response" | "authentication" | "forbidden" | "validation" | "unavailable";

export class AdminPromosClientError extends Error {
  readonly kind: AdminPromosClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(kind: AdminPromosClientErrorKind, message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminPromosClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminPromosClientOptions { readonly apiUrl: string; readonly fetchImpl?: FetchImplementation; readonly timeoutMs?: number }
export interface AdminPromosRequestOptions { readonly signal?: AbortSignal }

export interface AdminPromosClient {
  list(query?: AdminPromosQueryInput, options?: AdminPromosRequestOptions): Promise<AdminPromosResponse>;
  create(input: AdminPromoCreateRequest, options?: AdminPromosRequestOptions): Promise<{ readonly promo: AdminPromo }>;
  update(id: number, input: AdminPromoUpdateRequest, options?: AdminPromosRequestOptions): Promise<{ readonly promo: AdminPromo }>;
  listRedemptions(id: number, query?: AdminPromoRedemptionsQueryInput, options?: AdminPromosRequestOptions): Promise<AdminPromoRedemptionsResponse>;
  setActive(id: number, isActive: boolean, options?: AdminPromosRequestOptions): Promise<{ readonly promo: AdminPromo }>;
  archive(id: number, options?: AdminPromosRequestOptions): Promise<{ readonly promo: AdminPromo }>;
}

function baseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminPromosClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function errorForResponse(status: number, body: unknown): AdminPromosClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Промокоды временно недоступны";
  if (status === 401) return new AdminPromosClientError("authentication", message, code, status);
  if (status === 403) return new AdminPromosClientError("forbidden", message, code, status);
  if (status === 400) return new AdminPromosClientError("validation", message, code, status);
  if (status === 503 || code === "SERVICE_UNAVAILABLE") return new AdminPromosClientError("unavailable", message, code, status);
  return new AdminPromosClientError("http", message, code, status);
}

export function createAdminPromosClient(options: AdminPromosClientOptions): AdminPromosClient {
  const url = baseUrl(options.apiUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_ADMIN_PROMOS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AdminPromosClientError("configuration", "Timeout Backend API настроен некорректно");
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(path: string, method: "GET" | "POST" | "PATCH", schema: { safeParse(value: unknown): { success: boolean; data?: T } }, body: unknown, requestOptions: AdminPromosRequestOptions): Promise<T> {
    if (requestOptions.signal?.aborted === true) throw new AdminPromosClientError("aborted", "Запрос к Backend API отменён");
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => { timedOut = true; controller.abort(); reject(new AdminPromosClientError("timeout", "Backend API не ответил вовремя")); }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => { controller.abort(); reject(new AdminPromosClientError("aborted", "Запрос к Backend API отменён")); };
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
    });
    const operation = Promise.resolve().then(() => fetchImpl(`${url}${path}`, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "include",
      signal: controller.signal
    })).then(async (response) => {
      if (timedOut || requestOptions.signal?.aborted === true) throw new AdminPromosClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let responseBody: unknown;
      try { responseBody = await response.json(); } catch { throw new AdminPromosClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw errorForResponse(response.status, responseBody);
      const parsed = schema.safeParse(responseBody);
      if (!parsed.success || parsed.data === undefined) throw new AdminPromosClientError("invalid_response", "Backend API вернул некорректные промокоды");
      return parsed.data;
    });
    try {
      const races: Array<Promise<T>> = [operation, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminPromosClientError) throw error;
      if (timedOut) throw new AdminPromosClientError("timeout", "Backend API не ответил вовремя");
      throw new AdminPromosClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }

  return {
    list: (query = {}, requestOptions = {}) => {
      const parsed = AdminPromosQuerySchema.safeParse(query);
      if (!parsed.success) throw new AdminPromosClientError("validation", "Параметры списка промокодов некорректны");
      const params = new URLSearchParams({ limit: String(parsed.data.limit), offset: String(parsed.data.offset), search: parsed.data.search });
      if (parsed.data.status !== undefined) params.set("status", parsed.data.status);
      return request(`/admin/promos?${params.toString()}`, "GET", AdminPromosResponseSchema, undefined, requestOptions);
    },
    create: (input, requestOptions = {}) => {
      const parsed = AdminPromoCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminPromosClientError("validation", "Данные промокода некорректны");
      return request("/admin/promos", "POST", AdminPromoResponseSchema, parsed.data, requestOptions);
    },
    update: (id, input, requestOptions = {}) => {
      if (!Number.isInteger(id) || id < 1) throw new AdminPromosClientError("validation", "Идентификатор промокода некорректен");
      const parsed = AdminPromoUpdateRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminPromosClientError("validation", "Данные промокода некорректны");
      return request(`/admin/promos/${id}`, "PATCH", AdminPromoResponseSchema, parsed.data, requestOptions);
    },
    listRedemptions: (id, query = {}, requestOptions = {}) => {
      if (!Number.isInteger(id) || id < 1) throw new AdminPromosClientError("validation", "Идентификатор промокода некорректен");
      const parsed = AdminPromoRedemptionsQuerySchema.safeParse(query);
      if (!parsed.success) throw new AdminPromosClientError("validation", "Параметры истории промокода некорректны");
      const params = new URLSearchParams({ limit: String(parsed.data.limit), offset: String(parsed.data.offset) });
      return request(`/admin/promos/${id}/redemptions?${params.toString()}`, "GET", AdminPromoRedemptionsResponseSchema, undefined, requestOptions);
    },
    setActive: (id, isActive, requestOptions = {}) => {
      if (!Number.isInteger(id) || id < 1) throw new AdminPromosClientError("validation", "Идентификатор промокода некорректен");
      return request(`/admin/promos/${id}/${isActive ? "activate" : "deactivate"}`, "POST", AdminPromoResponseSchema, undefined, requestOptions);
    },
    archive: (id, requestOptions = {}) => {
      if (!Number.isInteger(id) || id < 1) throw new AdminPromosClientError("validation", "Идентификатор промокода некорректен");
      return request(`/admin/promos/${id}/archive`, "POST", AdminPromoResponseSchema, undefined, requestOptions);
    }
  };
}
