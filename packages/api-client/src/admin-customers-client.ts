import {
  AdminCustomersQuerySchema,
  AdminCustomersResponseSchema,
  ApiErrorSchema,
  type AdminCustomersQueryInput,
  type AdminCustomersResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_CUSTOMERS_TIMEOUT_MS = 10_000;
export type AdminCustomersClientErrorKind = "configuration" | "network" | "http" | "timeout" | "aborted" | "invalid_response" | "authentication" | "forbidden" | "validation" | "unavailable";

export class AdminCustomersClientError extends Error {
  readonly kind: AdminCustomersClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;
  constructor(kind: AdminCustomersClientErrorKind, message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminCustomersClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminCustomersClientOptions { readonly apiUrl: string; readonly fetchImpl?: FetchImplementation; readonly timeoutMs?: number }
export interface AdminCustomersRequestOptions { readonly signal?: AbortSignal }
export interface AdminCustomersClient { list(query?: AdminCustomersQueryInput, options?: AdminCustomersRequestOptions): Promise<AdminCustomersResponse> }

function baseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminCustomersClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function errorForResponse(status: number, body: unknown): AdminCustomersClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Список клиентов временно недоступен";
  if (status === 401) return new AdminCustomersClientError("authentication", message, code, status);
  if (status === 403) return new AdminCustomersClientError("forbidden", message, code, status);
  if (status === 503 || code === "SERVICE_UNAVAILABLE") return new AdminCustomersClientError("unavailable", message, code, status);
  return new AdminCustomersClientError("http", message, code, status);
}

export function createAdminCustomersClient(options: AdminCustomersClientOptions): AdminCustomersClient {
  const url = baseUrl(options.apiUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_ADMIN_CUSTOMERS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AdminCustomersClientError("configuration", "Timeout Backend API настроен некорректно");
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function list(query: AdminCustomersQueryInput = {}, requestOptions: AdminCustomersRequestOptions = {}): Promise<AdminCustomersResponse> {
    const parsedQuery = AdminCustomersQuerySchema.safeParse(query);
    if (!parsedQuery.success) throw new AdminCustomersClientError("validation", "Параметры списка клиентов некорректны");
    if (requestOptions.signal?.aborted === true) throw new AdminCustomersClientError("aborted", "Запрос к Backend API отменён");
    const params = new URLSearchParams({ limit: String(parsedQuery.data.limit), offset: String(parsedQuery.data.offset), search: parsedQuery.data.search });
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => { timedOut = true; controller.abort(); reject(new AdminCustomersClientError("timeout", "Backend API не ответил вовремя")); }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => { controller.abort(); reject(new AdminCustomersClientError("aborted", "Запрос к Backend API отменён")); };
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
    });
    const operation = Promise.resolve().then(() => fetchImpl(`${url}/admin/customers?${params.toString()}`, { method: "GET", headers: { Accept: "application/json" }, credentials: "include", signal: controller.signal })).then(async (response) => {
      if (timedOut || requestOptions.signal?.aborted === true) throw new AdminCustomersClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let body: unknown;
      try { body = await response.json(); } catch { throw new AdminCustomersClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw errorForResponse(response.status, body);
      const parsed = AdminCustomersResponseSchema.safeParse(body);
      if (!parsed.success) throw new AdminCustomersClientError("invalid_response", "Backend API вернул некорректный список клиентов");
      return parsed.data;
    });
    try {
      const races: Array<Promise<AdminCustomersResponse>> = [operation, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminCustomersClientError) throw error;
      if (timedOut) throw new AdminCustomersClientError("timeout", "Backend API не ответил вовремя");
      throw new AdminCustomersClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }
  return { list };
}
