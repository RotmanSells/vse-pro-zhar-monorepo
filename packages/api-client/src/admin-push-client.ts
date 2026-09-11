import {
  AdminPushSendRequestSchema,
  AdminPushSendResponseSchema,
  ApiErrorSchema,
  type AdminPushSendRequest,
  type AdminPushSendResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_PUSH_TIMEOUT_MS = 15_000;
export type AdminPushClientErrorKind = "configuration" | "network" | "http" | "timeout" | "aborted" | "invalid_response" | "authentication" | "forbidden" | "conflict" | "not_found" | "unavailable";

export class AdminPushClientError extends Error {
  readonly kind: AdminPushClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(kind: AdminPushClientErrorKind, message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminPushClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminPushClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface AdminPushRequestOptions {
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
}

export interface AdminPushClient {
  send(input: AdminPushSendRequest, options: AdminPushRequestOptions): Promise<AdminPushSendResponse>;
}

function baseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminPushClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function errorForResponse(status: number, body: unknown): AdminPushClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Push временно недоступен";
  if (status === 401) return new AdminPushClientError("authentication", message, code, status);
  if (status === 403) return new AdminPushClientError("forbidden", message, code, status);
  if (status === 404) return new AdminPushClientError("not_found", message, code, status);
  if (status === 409) return new AdminPushClientError("conflict", message, code, status);
  if (status === 503) return new AdminPushClientError("unavailable", message, code, status);
  return new AdminPushClientError("http", message, code, status);
}

export function createAdminPushClient(options: AdminPushClientOptions): AdminPushClient {
  const url = baseUrl(options.apiUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_ADMIN_PUSH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  return {
    async send(input, requestOptions) {
      const parsedInput = AdminPushSendRequestSchema.safeParse(input);
      if (!parsedInput.success || requestOptions.idempotencyKey.trim() === "") {
        throw new AdminPushClientError("configuration", "Данные Push-запроса некорректны");
      }
      if (requestOptions.signal?.aborted === true) throw new AdminPushClientError("aborted", "Запрос к Backend API отменён");
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const onAbort = (): void => controller.abort();
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        let response: Response;
        try {
          response = await fetchImpl(`${url}/admin/notifications/push`, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "Idempotency-Key": requestOptions.idempotencyKey.trim()
            },
            credentials: "include",
            body: JSON.stringify(parsedInput.data),
            signal: controller.signal
          });
        } catch {
          if (timedOut) throw new AdminPushClientError("timeout", "Backend API не ответил вовремя");
          if (controller.signal.aborted) throw new AdminPushClientError("aborted", "Запрос к Backend API отменён");
          throw new AdminPushClientError("network", "Не удалось связаться с Backend API");
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new AdminPushClientError("invalid_response", "Backend API вернул некорректный ответ");
        }
        if (!response.ok) throw errorForResponse(response.status, body);
        const parsedResponse = AdminPushSendResponseSchema.safeParse(body);
        if (!parsedResponse.success) throw new AdminPushClientError("invalid_response", "Backend API вернул некорректный Push-ответ");
        return parsedResponse.data;
      } finally {
        clearTimeout(timeoutId);
        requestOptions.signal?.removeEventListener("abort", onAbort);
      }
    }
  };
}
