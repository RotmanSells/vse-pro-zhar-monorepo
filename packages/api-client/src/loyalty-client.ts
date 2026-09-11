import {
  ApiErrorSchema,
  LoyaltyLedgerQuerySchema,
  LoyaltyLedgerResponseSchema,
  LoyaltyRedemptionRequestSchema,
  LoyaltyRedemptionResponseSchema,
  LoyaltyRedemptionsResponseSchema,
  LoyaltyRewardsResponseSchema,
  LoyaltySummaryResponseSchema,
  IdempotencyKeySchema,
  WheelSpinRequestSchema,
  WheelSpinResponseSchema,
  WheelStateResponseSchema,
  QuestStateResponseSchema,
  type ApiErrorCode,
  type LoyaltyLedgerQueryInput,
  type LoyaltyLedgerResponse,
  type LoyaltyRedemptionResponse,
  type LoyaltyRedemptionsResponse,
  type LoyaltyRewardsResponse,
  type LoyaltySummaryResponse,
  type WheelSpinRequest,
  type WheelSpinResponse,
  type WheelStateResponse,
  type QuestStateResponse
} from "@vse-pro-zhar/contracts";

import type { AuthSessionTransport } from "./auth-client.js";
import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_LOYALTY_TIMEOUT_MS = 10_000;

export type LoyaltyClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "unavailable"
  | "cooldown"
  | "limit_reached"
  | "not_eligible"
  | "rate_limited";

export class LoyaltyClientError extends Error {
  readonly kind: LoyaltyClientErrorKind;
  readonly code: ApiErrorCode | null;
  readonly status: number | null;

  constructor(
    kind: LoyaltyClientErrorKind,
    message: string,
    code: ApiErrorCode | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "LoyaltyClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface LoyaltyClientOptions {
  readonly apiUrl: string;
  readonly transport: AuthSessionTransport;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface LoyaltyRequestOptions { readonly signal?: AbortSignal }

export interface LoyaltyClient {
  getSummary(options?: LoyaltyRequestOptions): Promise<LoyaltySummaryResponse>;
  getLedger(query?: LoyaltyLedgerQueryInput, options?: LoyaltyRequestOptions): Promise<LoyaltyLedgerResponse>;
  getRewards?: (options?: LoyaltyRequestOptions) => Promise<LoyaltyRewardsResponse>;
  getRedemptions?: (query?: LoyaltyLedgerQueryInput, options?: LoyaltyRequestOptions) => Promise<LoyaltyRedemptionsResponse>;
  getRedemption?: (id: number, options?: LoyaltyRequestOptions) => Promise<LoyaltyRedemptionResponse>;
  redeem?: (rewardId: number, idempotencyKey: string, options?: LoyaltyRequestOptions) => Promise<LoyaltyRedemptionResponse>;
  getWheel?: (options?: LoyaltyRequestOptions) => Promise<WheelStateResponse>;
  getQuests?: (options?: LoyaltyRequestOptions) => Promise<QuestStateResponse>;
  spinWheel?: (input: WheelSpinRequest, idempotencyKey: string, options?: LoyaltyRequestOptions) => Promise<WheelSpinResponse>;
}

function resolveApiUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) throw new Error();
    return url.origin;
  } catch {
    throw new LoyaltyClientError("configuration", "Адрес Backend API настроен некорректно");
  }
}

function resolveTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_LOYALTY_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new LoyaltyClientError("configuration", "Timeout Backend API настроен некорректно");
  }
  return timeout;
}

function errorForResponse(status: number, body: unknown): LoyaltyClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success ? parsed.data.error.message : "Программа лояльности временно недоступна";
  if (status === 401 || status === 403) return new LoyaltyClientError("authentication", message, code, status);
  if (status === 429) return new LoyaltyClientError("rate_limited", message, code, status);
  if (code === "LOYALTY_WHEEL_COOLDOWN") return new LoyaltyClientError("cooldown", message, code, status);
  if (code === "LOYALTY_WHEEL_LIMIT_REACHED") return new LoyaltyClientError("limit_reached", message, code, status);
  if (code === "LOYALTY_WHEEL_NOT_ELIGIBLE") return new LoyaltyClientError("not_eligible", message, code, status);
  if (code === "LOYALTY_INSUFFICIENT_BALANCE" || code === "LOYALTY_INVALID_TRANSITION") return new LoyaltyClientError("http", message, code, status);
  if (status === 503 || code === "LOYALTY_UNAVAILABLE" || code === "LOYALTY_RECONCILIATION_REQUIRED") {
    return new LoyaltyClientError("unavailable", message, code, status);
  }
  return new LoyaltyClientError("http", message, code, status);
}

function abortError(): LoyaltyClientError {
  return new LoyaltyClientError("aborted", "Запрос к Backend API отменён");
}

export function createLoyaltyClient(options: LoyaltyClientOptions): LoyaltyClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function request<T>(
    path: string,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    requestOptions: LoyaltyRequestOptions,
    method: "GET" | "POST" = "GET",
    body?: unknown,
    idempotencyKey?: string
  ): Promise<T> {
    if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw abortError();
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new LoyaltyClientError("timeout", "Backend API не ответил вовремя"));
      }, timeoutMs);
    });
    const abort = requestOptions.signal === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          const onAbort = (): void => {
            controller.abort();
            reject(abortError());
          };
          requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
          removeAbort = () => requestOptions.signal?.removeEventListener("abort", onAbort);
        });
    const request = Promise.resolve()
      .then(async () => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...(await options.transport.getRequestHeaders()),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey })
        };
        if (options.transport.mode === "bearer") headers["X-Session-Transport"] = "bearer";
        return fetchImpl(`${apiUrl}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          credentials: "include",
          signal: controller.signal
        });
      })
      .then(async (response) => {
        if (timedOut || (requestOptions.signal !== undefined && requestOptions.signal.aborted)) {
          throw timedOut ? new LoyaltyClientError("timeout", "Backend API не ответил вовремя") : abortError();
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new LoyaltyClientError("invalid_response", "Backend API вернул некорректный ответ");
        }
        if (!response.ok) throw errorForResponse(response.status, body);
        const parsed = schema.safeParse(body);
        if (!parsed.success || parsed.data === undefined) {
          throw new LoyaltyClientError("invalid_response", "Backend API вернул некорректное состояние лояльности");
        }
        return parsed.data;
      });
    try {
      const races: Array<Promise<T>> = [request, timeout];
      if (abort !== undefined) races.push(abort);
      return await Promise.race(races);
    } catch (error: unknown) {
      if (error instanceof LoyaltyClientError) throw error;
      if (timedOut) throw new LoyaltyClientError("timeout", "Backend API не ответил вовремя");
      if (requestOptions.signal !== undefined && requestOptions.signal.aborted) throw abortError();
      throw new LoyaltyClientError("network", "Не удалось связаться с Backend API");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAbort?.();
    }
  }

  return {
    getSummary: (requestOptions = {}) => request("/loyalty", LoyaltySummaryResponseSchema, requestOptions),
    getLedger: (query = {}, requestOptions = {}) => {
      const parsed = LoyaltyLedgerQuerySchema.safeParse(query);
      if (!parsed.success) throw new LoyaltyClientError("validation", "Фильтр истории лояльности некорректен");
      const params = new URLSearchParams();
      params.set("limit", String(parsed.data.limit));
      params.set("offset", String(parsed.data.offset));
      if (parsed.data.entryType !== undefined) params.set("entryType", parsed.data.entryType);
      return request(`/loyalty/ledger?${params.toString()}`, LoyaltyLedgerResponseSchema, requestOptions);
    },
    getRewards: (requestOptions = {}) => request("/loyalty/rewards", LoyaltyRewardsResponseSchema, requestOptions),
    getRedemptions: (query = {}, requestOptions = {}) => {
      const parsed = LoyaltyLedgerQuerySchema.safeParse(query);
      if (!parsed.success) throw new LoyaltyClientError("validation", "Фильтр списаний лояльности некорректен");
      const params = new URLSearchParams({ limit: String(parsed.data.limit), offset: String(parsed.data.offset) });
      return request(`/loyalty/redemptions?${params.toString()}`, LoyaltyRedemptionsResponseSchema, requestOptions);
    },
    getRedemption: (id, requestOptions = {}) => {
      if (!Number.isSafeInteger(id) || id < 1) throw new LoyaltyClientError("validation", "Идентификатор списания некорректен");
      return request(`/loyalty/redemptions/${encodeURIComponent(String(id))}`, LoyaltyRedemptionResponseSchema, requestOptions);
    },
    redeem: (rewardId, idempotencyKey, requestOptions = {}) => {
      const parsedInput = LoyaltyRedemptionRequestSchema.safeParse({ rewardId });
      const parsedKey = IdempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsedInput.success || !parsedKey.success) throw new LoyaltyClientError("validation", "Данные обмена угольков некорректны");
      return request("/loyalty/redemptions", LoyaltyRedemptionResponseSchema, requestOptions, "POST", parsedInput.data, parsedKey.data);
    },
    getWheel: (requestOptions = {}) => request("/loyalty/wheel", WheelStateResponseSchema, requestOptions),
    getQuests: (requestOptions = {}) => request("/loyalty/quests", QuestStateResponseSchema, requestOptions),
    spinWheel: (input, idempotencyKey, requestOptions = {}) => {
      const parsedInput = WheelSpinRequestSchema.safeParse(input);
      const parsedKey = IdempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsedInput.success || !parsedKey.success) throw new LoyaltyClientError("validation", "Данные рулетки некорректны");
      return request("/loyalty/wheel/spin", WheelSpinResponseSchema, requestOptions, "POST", parsedInput.data, parsedKey.data);
    }
  };
}
