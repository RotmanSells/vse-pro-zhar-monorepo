import {
  AdminCommunicationDraftCreateRequestSchema,
  AdminCommunicationDraftDetailResponseSchema,
  AdminCommunicationDraftListResponseSchema,
  AdminCommunicationDraftResponseSchema,
  AdminCommunicationDraftsQuerySchema,
  AdminCommunicationDraftUpdateRequestSchema,
  AdminCommunicationDraftVersionRequestSchema,
  AdminCommunicationPreviewRequestSchema,
  AdminCommunicationPreviewResponseSchema,
  AdminCommunicationsResponseSchema,
  ApiErrorSchema,
  type AdminCommunicationDraftCreateRequest,
  type AdminCommunicationDraftDetailResponse,
  type AdminCommunicationDraftListResponse,
  type AdminCommunicationDraftResponse,
  type AdminCommunicationDraftsQueryInput,
  type AdminCommunicationDraftUpdateRequest,
  type AdminCommunicationDraftVersionRequest,
  type AdminCommunicationPreviewRequest,
  type AdminCommunicationPreviewResponse,
  type AdminCommunicationsResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_COMMUNICATIONS_TIMEOUT_MS = 10_000;
export type AdminCommunicationsClientErrorKind = "configuration" | "network" | "http" | "timeout" | "aborted" | "invalid_response" | "authentication" | "forbidden" | "validation" | "conflict" | "unavailable";

export class AdminCommunicationsClientError extends Error {
  readonly kind: AdminCommunicationsClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(kind: AdminCommunicationsClientErrorKind, message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminCommunicationsClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminCommunicationsClientOptions { readonly apiUrl: string; readonly fetchImpl?: FetchImplementation; readonly timeoutMs?: number }
export interface AdminCommunicationsRequestOptions { readonly signal?: AbortSignal }

export interface AdminCommunicationsClient {
  get(options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationsResponse>;
  listDrafts(query?: AdminCommunicationDraftsQueryInput, options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationDraftListResponse>;
  getDraft(id: number, options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationDraftDetailResponse>;
  createDraft(input: AdminCommunicationDraftCreateRequest, options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationDraftResponse>;
  updateDraft(id: number, input: AdminCommunicationDraftUpdateRequest, options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationDraftResponse>;
  archiveDraft(id: number, input: AdminCommunicationDraftVersionRequest, options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationDraftResponse>;
  restoreDraft(id: number, input: AdminCommunicationDraftVersionRequest, options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationDraftResponse>;
  preview(input: AdminCommunicationPreviewRequest, options?: AdminCommunicationsRequestOptions): Promise<AdminCommunicationPreviewResponse>;
}

function baseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminCommunicationsClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function errorForResponse(status: number, body: unknown): AdminCommunicationsClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Коммуникации временно недоступны";
  if (status === 401) return new AdminCommunicationsClientError("authentication", message, code, status);
  if (status === 403) return new AdminCommunicationsClientError("forbidden", message, code, status);
  if (status === 400) return new AdminCommunicationsClientError("validation", message, code, status);
  if (status === 409 || code === "COMMUNICATION_DRAFT_CONFLICT" || code === "COMMUNICATION_IDEMPOTENCY_CONFLICT") return new AdminCommunicationsClientError("conflict", message, code, status);
  if (status === 503 || code === "SERVICE_UNAVAILABLE" || code === "COMMUNICATION_UNAVAILABLE") return new AdminCommunicationsClientError("unavailable", message, code, status);
  return new AdminCommunicationsClientError("http", message, code, status);
}

function pathWithQuery(path: string, query: AdminCommunicationDraftsQueryInput | undefined): string {
  const parsed = AdminCommunicationDraftsQuerySchema.parse(query ?? {});
  const params = new URLSearchParams({ limit: String(parsed.limit), offset: String(parsed.offset), search: parsed.search });
  if (parsed.status !== undefined) params.set("status", parsed.status);
  return `${path}?${params.toString()}`;
}

export function createAdminCommunicationsClient(options: AdminCommunicationsClientOptions): AdminCommunicationsClient {
  const url = baseUrl(options.apiUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_ADMIN_COMMUNICATIONS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AdminCommunicationsClientError("configuration", "Timeout Backend API настроен некорректно");
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(path: string, method: "GET" | "POST" | "PATCH", schema: { safeParse(value: unknown): { success: boolean; data?: T } }, body: unknown, requestOptions: AdminCommunicationsRequestOptions): Promise<T> {
    if (requestOptions.signal?.aborted === true) throw new AdminCommunicationsClientError("aborted", "Запрос к Backend API отменён");
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => { timedOut = true; controller.abort(); reject(new AdminCommunicationsClientError("timeout", "Backend API не ответил вовремя")); }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => { controller.abort(); reject(new AdminCommunicationsClientError("aborted", "Запрос к Backend API отменён")); };
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
      if (timedOut || requestOptions.signal?.aborted === true) throw new AdminCommunicationsClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let responseBody: unknown;
      try { responseBody = await response.json(); } catch { throw new AdminCommunicationsClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw errorForResponse(response.status, responseBody);
      const parsed = schema.safeParse(responseBody);
      if (!parsed.success || parsed.data === undefined) throw new AdminCommunicationsClientError("invalid_response", "Backend API вернул некорректный ответ коммуникаций");
      return parsed.data;
    });
    try {
      const races: Array<Promise<T>> = [operation, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminCommunicationsClientError) throw error;
      if (timedOut) throw new AdminCommunicationsClientError("timeout", "Backend API не ответил вовремя");
      if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw new AdminCommunicationsClientError("aborted", "Запрос к Backend API отменён");
      throw new AdminCommunicationsClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }

  return {
    get: (requestOptions = {}) => request("/admin/communications", "GET", AdminCommunicationsResponseSchema, undefined, requestOptions),
    listDrafts: (query, requestOptions = {}) => request(pathWithQuery("/admin/communications/drafts", query), "GET", AdminCommunicationDraftListResponseSchema, undefined, requestOptions),
    getDraft: (id, requestOptions = {}) => request(`/admin/communications/drafts/${id}`, "GET", AdminCommunicationDraftDetailResponseSchema, undefined, requestOptions),
    createDraft: (input, requestOptions = {}) => {
      const parsed = AdminCommunicationDraftCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminCommunicationsClientError("validation", "Данные черновика коммуникации некорректны");
      return request("/admin/communications/drafts", "POST", AdminCommunicationDraftResponseSchema, parsed.data, requestOptions);
    },
    updateDraft: (id, input, requestOptions = {}) => {
      const parsed = AdminCommunicationDraftUpdateRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminCommunicationsClientError("validation", "Данные черновика коммуникации некорректны");
      return request(`/admin/communications/drafts/${id}`, "PATCH", AdminCommunicationDraftResponseSchema, parsed.data, requestOptions);
    },
    archiveDraft: (id, input, requestOptions = {}) => {
      const parsed = AdminCommunicationDraftVersionRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminCommunicationsClientError("validation", "Версия черновика коммуникации некорректна");
      return request(`/admin/communications/drafts/${id}/archive`, "POST", AdminCommunicationDraftResponseSchema, parsed.data, requestOptions);
    },
    restoreDraft: (id, input, requestOptions = {}) => {
      const parsed = AdminCommunicationDraftVersionRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminCommunicationsClientError("validation", "Версия черновика коммуникации некорректна");
      return request(`/admin/communications/drafts/${id}/restore`, "POST", AdminCommunicationDraftResponseSchema, parsed.data, requestOptions);
    },
    preview: (input, requestOptions = {}) => {
      const parsed = AdminCommunicationPreviewRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminCommunicationsClientError("validation", "Данные preview коммуникации некорректны");
      return request("/admin/communications/preview", "POST", AdminCommunicationPreviewResponseSchema, parsed.data, requestOptions);
    }
  };
}
