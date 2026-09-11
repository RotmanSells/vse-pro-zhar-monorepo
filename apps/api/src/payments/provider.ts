import {
  YooKassaPaymentObjectSchema,
  YooKassaRefundObjectSchema,
  type PaymentProviderStatus,
  type YooKassaPaymentObject,
  type YooKassaRefundStatus
} from "@vse-pro-zhar/contracts";

import { loadYooKassaConfig, type YooKassaConfig } from "./config.js";
import { PaymentUnavailableError } from "./errors.js";

const DEFAULT_YOOKASSA_TIMEOUT_MS = 8_000;
const MAX_SAFE_MINOR_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export interface PaymentProviderPayment {
  readonly providerPaymentId: string;
  readonly providerStatus: PaymentProviderStatus;
  readonly amountMinor: number;
  readonly currency: string;
  readonly confirmationType: "redirect" | null;
  readonly confirmationUrl: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly paid: boolean;
  readonly test: boolean;
}

export interface PaymentProviderCreateInput {
  readonly orderId: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly idempotencyKey: string;
}

export interface PaymentProvider {
  createPayment(input: PaymentProviderCreateInput): Promise<PaymentProviderPayment>;
  getPayment(providerPaymentId: string): Promise<PaymentProviderPayment>;
}

export interface RefundProviderResult {
  readonly providerRefundId: string;
  readonly providerStatus: YooKassaRefundStatus;
  readonly paymentProviderId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface RefundProvider {
  createRefund(input: {
    readonly orderId: number;
    readonly paymentProviderId: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly idempotencyKey: string;
  }): Promise<RefundProviderResult>;
  getRefund(providerRefundId: string): Promise<RefundProviderResult>;
}

export interface YooKassaProviderOptions {
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

export interface YooKassaProviderErrorDetails {
  readonly httpStatus: number | null;
  readonly providerErrorId: string | null;
  readonly providerCode: string | null;
  readonly providerDescription: string | null;
  readonly providerParameter: string | null;
  readonly providerRequestId: string | null;
}

export class YooKassaProviderError extends Error {
  readonly kind: "unavailable" | "invalid_response";
  readonly details: YooKassaProviderErrorDetails;

  constructor(
    kind: "unavailable" | "invalid_response",
    details: Partial<YooKassaProviderErrorDetails> = {}
  ) {
    super("YooKassa provider request failed");
    this.name = "YooKassaProviderError";
    this.kind = kind;
    this.details = {
      httpStatus: details.httpStatus ?? null,
      providerErrorId: details.providerErrorId ?? null,
      providerCode: details.providerCode ?? null,
      providerDescription: details.providerDescription ?? null,
      providerParameter: details.providerParameter ?? null,
      providerRequestId: details.providerRequestId ?? null
    };
  }
}

function providerError(
  kind: YooKassaProviderError["kind"],
  details?: Partial<YooKassaProviderErrorDetails>
): YooKassaProviderError {
  return new YooKassaProviderError(kind, details);
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_YOOKASSA_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) throw providerError("unavailable");
  return value;
}

function minorToProviderValue(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw providerError("invalid_response");
  }
  const rubles = Math.floor(amountMinor / 100);
  const kopecks = amountMinor % 100;
  return `${rubles}.${String(kopecks).padStart(2, "0")}`;
}

function providerValueToMinor(value: string): number {
  const [rublesText, kopecksText] = value.split(".");
  if (rublesText === undefined || kopecksText === undefined) {
    throw providerError("invalid_response");
  }
  try {
    const minor = BigInt(rublesText) * 100n + BigInt(kopecksText);
    if (minor < 0n || minor > MAX_SAFE_MINOR_BIGINT) {
      throw providerError("invalid_response");
    }
    return Number(minor);
  } catch (error: unknown) {
    if (error instanceof YooKassaProviderError) throw error;
    throw providerError("invalid_response");
  }
}

function normalizePayment(raw: unknown): PaymentProviderPayment {
  const parsed = YooKassaPaymentObjectSchema.safeParse(raw);
  if (!parsed.success || parsed.data.test !== true) {
    throw providerError("invalid_response");
  }

  const payment: YooKassaPaymentObject = parsed.data;
  const confirmation = payment.confirmation;
  if (
    confirmation !== undefined &&
    (confirmation.type !== "redirect" || confirmation.confirmation_url === undefined)
  ) {
    throw providerError("invalid_response");
  }

  return {
    providerPaymentId: payment.id,
    providerStatus: payment.status,
    amountMinor: providerValueToMinor(payment.amount.value),
    currency: payment.amount.currency,
    confirmationType: confirmation === undefined ? null : "redirect",
    confirmationUrl: confirmation?.confirmation_url ?? null,
    metadata: payment.metadata ?? {},
    paid: payment.paid,
    test: payment.test
  };
}

function normalizeRefund(raw: unknown): RefundProviderResult {
  const parsed = YooKassaRefundObjectSchema.safeParse(raw);
  if (!parsed.success) throw providerError("invalid_response");
  const refund = parsed.data;
  const [rublesText, kopecksText] = refund.amount.value.split(".");
  if (rublesText === undefined || kopecksText === undefined) {
    throw providerError("invalid_response");
  }
  try {
    const amountMinor = BigInt(rublesText) * 100n + BigInt(kopecksText);
    if (amountMinor < 0n || amountMinor > MAX_SAFE_MINOR_BIGINT) {
      throw providerError("invalid_response");
    }
    return {
      providerRefundId: refund.id,
      providerStatus: refund.status,
      paymentProviderId: refund.payment_id,
      amountMinor: Number(amountMinor),
      currency: refund.amount.currency
    };
  } catch (error: unknown) {
    if (error instanceof YooKassaProviderError) throw error;
    throw providerError("invalid_response");
  }
}

function endpoint(config: YooKassaConfig, path: string): string {
  return `${config.baseUrl}${path}`;
}

function authHeader(config: YooKassaConfig): string {
  return `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`, "utf8").toString("base64")}`;
}

function readErrorString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() !== ""
    ? value.slice(0, maxLength)
    : null;
}

function readProviderErrorDetails(
  response: Response,
  body: unknown
): YooKassaProviderErrorDetails {
  const error = typeof body === "object" && body !== null ? body : {};
  const errorRecord = error as Record<string, unknown>;
  return {
    httpStatus: response.status,
    providerErrorId: readErrorString(errorRecord["id"], 160),
    providerCode: readErrorString(errorRecord["code"], 80),
    providerDescription: readErrorString(errorRecord["description"], 512),
    providerParameter: readErrorString(errorRecord["parameter"], 160),
    providerRequestId:
      response.headers.get("X-Request-ID") ??
      response.headers.get("X-Correlation-ID") ??
      null
  };
}

async function requestJson(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  config: YooKassaConfig,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const request = Promise.resolve()
    .then(() =>
      fetchImpl(url, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: authHeader(config),
          ...(init.headers ?? {})
        },
        signal: controller.signal
      })
    )
    .then(async (response) => {
      const bodyText = await response.text();
      if (!response.ok) {
        const body = (() => {
          try {
            return JSON.parse(bodyText) as unknown;
          } catch {
            return undefined;
          }
        })();
        throw providerError("unavailable", readProviderErrorDetails(response, body));
      }
      try {
        return JSON.parse(bodyText) as unknown;
      } catch {
        throw providerError("invalid_response");
      }
    });

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(providerError("unavailable"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } catch (error: unknown) {
    if (error instanceof YooKassaProviderError) throw error;
    throw providerError("unavailable");
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function createYooKassaProvider(
  config: YooKassaConfig,
  options: YooKassaProviderOptions = {}
): PaymentProvider & RefundProvider {
  const fetchImpl =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const timeoutMs = resolveTimeout(options.timeoutMs);

  return {
    async createPayment(input) {
      const raw = await requestJson(
        fetchImpl,
        endpoint(config, "/v3/payments"),
        config,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotence-Key": input.idempotencyKey
          },
          body: JSON.stringify({
            amount: {
              value: minorToProviderValue(input.amountMinor),
              currency: input.currency
            },
            payment_method_data: { type: "bank_card" },
            confirmation: {
              type: "redirect",
              return_url: config.returnUrl
            },
            capture: true,
            description: `Оплата заказа №${input.orderId}`,
            metadata: { order_id: String(input.orderId) }
          })
        },
        timeoutMs
      );
      return normalizePayment(raw);
    },

    async getPayment(providerPaymentId) {
      const raw = await requestJson(
        fetchImpl,
        endpoint(config, `/v3/payments/${encodeURIComponent(providerPaymentId)}`),
        config,
        { method: "GET" },
        timeoutMs
      );
      return normalizePayment(raw);
    },

    async createRefund(input) {
      const raw = await requestJson(
        fetchImpl,
        endpoint(config, "/v3/refunds"),
        config,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotence-Key": input.idempotencyKey
          },
          body: JSON.stringify({
            payment_id: input.paymentProviderId,
            amount: {
              value: minorToProviderValue(input.amountMinor),
              currency: input.currency
            },
            description: `Возврат заказа №${input.orderId}`
          })
        },
        timeoutMs
      );
      return normalizeRefund(raw);
    },

    async getRefund(providerRefundId) {
      const raw = await requestJson(
        fetchImpl,
        endpoint(config, `/v3/refunds/${encodeURIComponent(providerRefundId)}`),
        config,
        { method: "GET" },
        timeoutMs
      );
      return normalizeRefund(raw);
    }
  };
}

export function createUnavailablePaymentProvider(): PaymentProvider & RefundProvider {
  return {
    async createPayment() {
      throw new PaymentUnavailableError();
    },
    async getPayment() {
      throw new PaymentUnavailableError();
    },
    async createRefund() {
      throw new PaymentUnavailableError();
    },
    async getRefund() {
      throw new PaymentUnavailableError();
    }
  };
}

export function createYooKassaProviderFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: YooKassaProviderOptions = {}
): PaymentProvider & RefundProvider {
  const config = loadYooKassaConfig(env);
  return config === null
    ? createUnavailablePaymentProvider()
    : createYooKassaProvider(config, options);
}
