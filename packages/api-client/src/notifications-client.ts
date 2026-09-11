import {
  ApiErrorSchema,
  CustomerNotificationDeviceListResponseSchema,
  CustomerNotificationDeviceRegisterRequestSchema,
  CustomerNotificationDeviceResponseSchema,
  CustomerNotificationDeviceRevokeResponseSchema,
  CustomerNotificationPreferencesResponseSchema,
  CustomerNotificationPreferencesUpdateRequestSchema,
  type ApiErrorCode,
  type CustomerNotificationDeviceListResponse,
  type CustomerNotificationDeviceRegisterRequest,
  type CustomerNotificationDeviceResponse,
  type CustomerNotificationDeviceRevokeResponse,
  type CustomerNotificationPreferencesResponse,
  type CustomerNotificationPreferencesUpdateRequest
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";
import type { AuthSessionTransport } from "./auth-client.js";

export class NotificationsClientError extends Error {
  readonly kind: "network" | "http" | "timeout" | "authentication" | "validation";
  readonly code: ApiErrorCode | null;

  constructor(kind: NotificationsClientError["kind"], message: string, code: ApiErrorCode | null = null) {
    super(message);
    this.name = "NotificationsClientError";
    this.kind = kind;
    this.code = code;
  }
}

export interface NotificationsClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface NotificationsClient {
  registerDevice(input: CustomerNotificationDeviceRegisterRequest): Promise<CustomerNotificationDeviceResponse>;
  listDevices(): Promise<CustomerNotificationDeviceListResponse>;
  revokeDevice(id: number): Promise<CustomerNotificationDeviceRevokeResponse>;
  getPreferences(): Promise<CustomerNotificationPreferencesResponse>;
  updatePreferences(input: CustomerNotificationPreferencesUpdateRequest): Promise<CustomerNotificationPreferencesResponse>;
}

function apiUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new NotificationsClientError("validation", "Адрес Backend API настроен некорректно");
  }
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new NotificationsClientError("network", "Backend API вернул некорректный ответ"); }
}

export function createNotificationsClient(options: NotificationsClientOptions): NotificationsClient {
  const baseUrl = apiUrl(options.apiUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", input: unknown, inputSchema: { safeParse(value: unknown): { success: boolean; data?: unknown } } | undefined, schema: { safeParse(value: unknown): { success: boolean; data?: T } }): Promise<T> {
    if (inputSchema !== undefined) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new NotificationsClientError("validation", "Проверьте данные уведомлений");
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json", ...(await options.transport.getRequestHeaders()) };
      if (input !== undefined) headers["Content-Type"] = "application/json";
      if (options.transport.mode === "bearer") headers["X-Session-Transport"] = "bearer";
      const response = await fetchImpl(`${baseUrl}${path}`, { method, headers, credentials: "include", signal: controller.signal, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      const body = await json(response);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(body);
        const code = parsed.success ? parsed.data.error.code : null;
        const message = parsed.success ? parsed.data.error.message : "Сервис уведомлений временно недоступен";
        throw new NotificationsClientError(response.status === 401 ? "authentication" : "http", message, code);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success || parsed.data === undefined) throw new NotificationsClientError("network", "Backend API вернул некорректный ответ");
      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof NotificationsClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new NotificationsClientError("timeout", "Backend API не ответил вовремя");
      throw new NotificationsClientError("network", "Не удалось связаться с Backend API");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    registerDevice: (input) => request("/notifications/devices", "POST", input, CustomerNotificationDeviceRegisterRequestSchema, CustomerNotificationDeviceResponseSchema),
    listDevices: () => request("/notifications/devices", "GET", undefined, undefined, CustomerNotificationDeviceListResponseSchema),
    revokeDevice: (id) => request(`/notifications/devices/${id}`, "DELETE", undefined, undefined, CustomerNotificationDeviceRevokeResponseSchema),
    getPreferences: () => request("/notifications/preferences", "GET", undefined, undefined, CustomerNotificationPreferencesResponseSchema),
    updatePreferences: (input) => request("/notifications/preferences", "PATCH", input, CustomerNotificationPreferencesUpdateRequestSchema, CustomerNotificationPreferencesResponseSchema)
  };
}
