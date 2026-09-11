import {
  AdminLoyaltyLedgerResponseSchema,
  AdminLoyaltyRewardsResponseSchema,
  AdminLoyaltyQuerySchema,
  AdminQuestsResponseSchema,
  AdminWheelResponseSchema,
  ApiErrorSchema,
  IdempotencyKeySchema,
  QuestDefinitionCreateRequestSchema,
  WheelPrizeCreateRequestSchema,
  QuestDefinitionUpdateRequestSchema,
  LoyaltyRewardCreateRequestSchema,
  LoyaltyRewardUpdateRequestSchema,
  WheelPrizeUpdateRequestSchema,
  WheelSettingsUpdateRequestSchema,
  type AdminLoyaltyLedgerResponse,
  type AdminLoyaltyRewardsResponse,
  type AdminLoyaltyQueryInput,
  type ApiErrorCode,
  type AdminQuestsResponse,
  type QuestDefinitionCreateRequest,
  type AdminWheelResponse,
  type QuestDefinitionUpdateRequest,
  type WheelPrizeCreateRequest,
  type WheelPrizeUpdateRequest,
  type WheelSettingsUpdateRequest
  , type LoyaltyRewardCreateRequest,
  type LoyaltyRewardUpdateRequest
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_ADMIN_LOYALTY_TIMEOUT_MS = 10_000;

export type AdminLoyaltyClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "forbidden"
  | "conflict"
  | "unavailable"
  | "rate_limited";

export class AdminLoyaltyClientError extends Error {
  readonly kind: AdminLoyaltyClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(kind: AdminLoyaltyClientErrorKind, message: string, code: ApiErrorCode | null = null, status: number | null = null) {
    super(message);
    this.name = "AdminLoyaltyClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface AdminLoyaltyClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}
export interface AdminLoyaltyRequestOptions { readonly signal?: AbortSignal; readonly idempotencyKey?: string }
export interface AdminLoyaltyClient {
  list(query?: AdminLoyaltyQueryInput, options?: AdminLoyaltyRequestOptions): Promise<AdminLoyaltyLedgerResponse>;
  listRewards?: (options?: AdminLoyaltyRequestOptions) => Promise<AdminLoyaltyRewardsResponse>;
  createReward?: (input: LoyaltyRewardCreateRequest, options?: AdminLoyaltyRequestOptions) => Promise<AdminLoyaltyRewardsResponse>;
  updateReward?: (id: number, input: LoyaltyRewardUpdateRequest, options?: AdminLoyaltyRequestOptions) => Promise<AdminLoyaltyRewardsResponse>;
  getWheel(options?: AdminLoyaltyRequestOptions): Promise<AdminWheelResponse>;
  updateWheelSettings(input: WheelSettingsUpdateRequest, options?: AdminLoyaltyRequestOptions): Promise<AdminWheelResponse>;
  createWheelPrize(input: WheelPrizeCreateRequest, options?: AdminLoyaltyRequestOptions): Promise<AdminWheelResponse>;
  updateWheelPrize(id: number, input: WheelPrizeUpdateRequest, options?: AdminLoyaltyRequestOptions): Promise<AdminWheelResponse>;
  getQuests(options?: AdminLoyaltyRequestOptions): Promise<AdminQuestsResponse>;
  createQuest(input: QuestDefinitionCreateRequest, options?: AdminLoyaltyRequestOptions): Promise<AdminQuestsResponse>;
  updateQuest(id: number, input: QuestDefinitionUpdateRequest, options?: AdminLoyaltyRequestOptions): Promise<AdminQuestsResponse>;
}

function apiUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error();
    return url.origin;
  } catch {
    throw new AdminLoyaltyClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}
function timeoutValue(value: number | undefined): number {
  const timeout = value ?? DEFAULT_ADMIN_LOYALTY_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new AdminLoyaltyClientError("configuration", "Timeout Backend API настроен некорректно");
  return timeout;
}
function errorForResponse(status: number, body: unknown): AdminLoyaltyClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Программа лояльности временно недоступна";
  if (status === 401) return new AdminLoyaltyClientError("authentication", message, code, status);
  if (status === 403) return new AdminLoyaltyClientError("forbidden", message, code, status);
  if (status === 400) return new AdminLoyaltyClientError("validation", message, code, status);
  if (status === 409 || code === "LOYALTY_QUEST_CONFLICT" || code === "LOYALTY_QUEST_CODE_CONFLICT" || code === "LOYALTY_QUEST_IDEMPOTENCY_CONFLICT" || code === "LOYALTY_WHEEL_SETTINGS_CONFLICT" || code === "LOYALTY_WHEEL_SETTINGS_IDEMPOTENCY_CONFLICT" || code === "LOYALTY_REWARD_CONFLICT" || code === "LOYALTY_REWARD_CODE_CONFLICT" || code === "LOYALTY_REWARD_IDEMPOTENCY_CONFLICT") return new AdminLoyaltyClientError("conflict", message, code, status);
  if (status === 429) return new AdminLoyaltyClientError("rate_limited", message, code, status);
  if (status === 503 || code === "LOYALTY_UNAVAILABLE" || code === "LOYALTY_RECONCILIATION_REQUIRED") return new AdminLoyaltyClientError("unavailable", message, code, status);
  return new AdminLoyaltyClientError("http", message, code, status);
}

export function createAdminLoyaltyClient(options: AdminLoyaltyClientOptions): AdminLoyaltyClient {
  const baseUrl = apiUrl(options.apiUrl);
  const timeoutMs = timeoutValue(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  async function request<T>(path: string, schema: { safeParse(value: unknown): { success: boolean; data?: T } }, requestOptions: AdminLoyaltyRequestOptions, method: "GET" | "PATCH" | "POST" = "GET", body?: unknown, idempotencyKey?: string): Promise<T> {
    if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw new AdminLoyaltyClientError("aborted", "Запрос к Backend API отменён");
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => { timedOut = true; controller.abort(); reject(new AdminLoyaltyClientError("timeout", "Backend API не ответил вовремя")); }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined ? undefined : new Promise<never>((_, reject) => {
      const onAbort = (): void => { controller.abort(); reject(new AdminLoyaltyClientError("aborted", "Запрос к Backend API отменён")); };
      requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
    });
    const operation = Promise.resolve().then(() => fetchImpl(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: "include", signal: controller.signal })).then(async (response) => {
      if (timedOut || (requestOptions.signal !== undefined && requestOptions.signal.aborted)) throw new AdminLoyaltyClientError(timedOut ? "timeout" : "aborted", timedOut ? "Backend API не ответил вовремя" : "Запрос к Backend API отменён");
      let body: unknown;
      try { body = await response.json(); } catch { throw new AdminLoyaltyClientError("invalid_response", "Backend API вернул некорректный ответ"); }
      if (!response.ok) throw errorForResponse(response.status, body);
      const parsed = schema.safeParse(body);
      if (!parsed.success || parsed.data === undefined) throw new AdminLoyaltyClientError("invalid_response", "Backend API вернул некорректную историю лояльности");
      return parsed.data;
    });
    try {
      const races: Array<Promise<T>> = [operation, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof AdminLoyaltyClientError) throw error;
      if (timedOut) throw new AdminLoyaltyClientError("timeout", "Backend API не ответил вовремя");
      if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw new AdminLoyaltyClientError("aborted", "Запрос к Backend API отменён");
      throw new AdminLoyaltyClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
  return {
    list: (query = {}, requestOptions = {}) => {
      const parsed = AdminLoyaltyQuerySchema.safeParse(query);
      if (!parsed.success) throw new AdminLoyaltyClientError("validation", "Фильтр истории лояльности некорректен");
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed.data)) if (value !== undefined) params.set(key, String(value));
      return request(`/admin/loyalty/ledger?${params.toString()}`, AdminLoyaltyLedgerResponseSchema, requestOptions);
    },
    listRewards: (requestOptions = {}) => request("/admin/loyalty/rewards", AdminLoyaltyRewardsResponseSchema, requestOptions),
    createReward: (input, requestOptions = {}) => {
      const parsed = LoyaltyRewardCreateRequestSchema.safeParse(input);
      const parsedKey = IdempotencyKeySchema.safeParse(requestOptions.idempotencyKey);
      if (!parsed.success || !parsedKey.success) throw new AdminLoyaltyClientError("validation", "Новая reward definition некорректна");
      return request("/admin/loyalty/rewards", AdminLoyaltyRewardsResponseSchema, requestOptions, "POST", parsed.data, parsedKey.data);
    },
    updateReward: (id, input, requestOptions = {}) => {
      const parsedId = Number.isSafeInteger(id) && id > 0;
      const parsed = LoyaltyRewardUpdateRequestSchema.safeParse(input);
      const parsedKey = IdempotencyKeySchema.safeParse(requestOptions.idempotencyKey);
      if (!parsedId || !parsed.success || !parsedKey.success) throw new AdminLoyaltyClientError("validation", "Reward definition некорректна");
      return request(`/admin/loyalty/rewards/${encodeURIComponent(String(id))}`, AdminLoyaltyRewardsResponseSchema, requestOptions, "PATCH", parsed.data, parsedKey.data);
    },
    getWheel: (requestOptions = {}) => request("/admin/loyalty/wheel", AdminWheelResponseSchema, requestOptions),
    updateWheelSettings: (input, requestOptions = {}) => {
      const parsed = WheelSettingsUpdateRequestSchema.safeParse(input);
      const parsedKey = IdempotencyKeySchema.safeParse(requestOptions.idempotencyKey);
      if (!parsed.success || !parsedKey.success) throw new AdminLoyaltyClientError("validation", "Настройки рулетки некорректны");
      return request("/admin/loyalty/wheel/settings", AdminWheelResponseSchema, requestOptions, "PATCH", parsed.data, parsedKey.data);
    },
    createWheelPrize: (input, requestOptions = {}) => {
      const parsed = WheelPrizeCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminLoyaltyClientError("validation", "Новый приз рулетки некорректен");
      return request("/admin/loyalty/wheel/prizes", AdminWheelResponseSchema, requestOptions, "POST", parsed.data);
    },
    updateWheelPrize: (id, input, requestOptions = {}) => {
      const parsedId = Number.isSafeInteger(id) && id > 0;
      const parsed = WheelPrizeUpdateRequestSchema.safeParse(input);
      const parsedKey = IdempotencyKeySchema.safeParse(requestOptions.idempotencyKey);
      if (!parsedId || !parsed.success || !parsedKey.success) throw new AdminLoyaltyClientError("validation", "Приз рулетки некорректен");
      return request(`/admin/loyalty/wheel/prizes/${encodeURIComponent(String(id))}`, AdminWheelResponseSchema, requestOptions, "PATCH", parsed.data, parsedKey.data);
    },
    getQuests: (requestOptions = {}) => request("/admin/loyalty/quests", AdminQuestsResponseSchema, requestOptions),
    createQuest: (input, requestOptions = {}) => {
      const parsed = QuestDefinitionCreateRequestSchema.safeParse(input);
      const parsedKey = IdempotencyKeySchema.safeParse(requestOptions.idempotencyKey);
      if (!parsed.success || !parsedKey.success) throw new AdminLoyaltyClientError("validation", "Новый квест некорректен");
      return request("/admin/loyalty/quests", AdminQuestsResponseSchema, requestOptions, "POST", parsed.data, parsedKey.data);
    },
    updateQuest: (id, input, requestOptions = {}) => {
      const parsedId = Number.isSafeInteger(id) && id > 0;
      const parsed = QuestDefinitionUpdateRequestSchema.safeParse(input);
      if (!parsedId || !parsed.success) throw new AdminLoyaltyClientError("validation", "Квест некорректен");
      return request(`/admin/loyalty/quests/${encodeURIComponent(String(id))}`, AdminQuestsResponseSchema, requestOptions, "PATCH", parsed.data);
    }
  };
}
