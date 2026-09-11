import { z } from "zod";

import type {
  IikoDispatchOrder,
  IikoDispatchOrderItem
} from "@vse-pro-zhar/database";

import {
  loadIikoFulfillmentConfig,
  type IikoFulfillmentConfig
} from "./config.js";

const DEFAULT_IIKO_TIMEOUT_MS = 5_000;
const IikoIdSchema = z.string().trim().min(1).max(160);
const IikoUuidSchema = z.string().trim().uuid();
const IikoOrderStatusSchema = z.enum([
  "New",
  "Unconfirmed",
  "WaitCooking",
  "ReadyForCooking",
  "CookingStarted",
  "CookingCompleted",
  "Waiting",
  "OnWay",
  "Delivered",
  "Closed",
  "Cancelled",
  "Deleted",
  "Problem",
  "Bill",
  "Paid",
  "WaitingForPayment"
]);

const IikoTokenResponseSchema = z
  .object({
    correlationId: IikoIdSchema,
    token: z.string().trim().min(1).max(500)
  })
  .strict();

const IikoErrorInfoSchema = z
  .object({ code: z.string().trim().min(1).max(160) })
  .passthrough();

const IikoCreateOrderInfoSchema = z
  .object({
    id: IikoUuidSchema,
    creationStatus: z.enum(["Success", "InProgress", "Error"]),
    errorInfo: IikoErrorInfoSchema.nullable().optional()
  })
  .passthrough();

const IikoCreateResponseSchema = z
  .object({
    correlationId: IikoIdSchema,
    orderInfo: IikoCreateOrderInfoSchema
  })
  .strict();

const IikoCommandResponseSchema = z
  .object({
    state: z.enum(["InProgress", "Success", "Error"]),
    exception: z.unknown().optional(),
    errorReason: z.string().trim().max(500).optional()
  })
  .strict();

const IikoOrderSchema = z
  .object({
    id: IikoUuidSchema,
    organizationId: IikoUuidSchema,
    order: z
      .object({
        status: IikoOrderStatusSchema,
        sum: z.number().finite()
      })
      .passthrough()
  })
  .passthrough();

const IikoOrdersResponseSchema = z
  .object({
    correlationId: IikoIdSchema,
    orders: z.array(IikoOrderSchema)
  })
  .strict();

export type IikoFulfillmentOrderStatus = z.infer<typeof IikoOrderStatusSchema>;

export interface IikoFulfillmentCreateInput {
  readonly order: IikoDispatchOrder;
  readonly correlationId: string;
}

export interface IikoFulfillmentCreateResult {
  readonly providerOrderId: string;
  readonly commandId: string | null;
  readonly state: "submitted" | "command_pending";
}

export interface IikoFulfillmentCommandResult {
  readonly state: "pending" | "succeeded";
}

export interface IikoFulfillmentOrderResult {
  readonly providerOrderId: string;
  readonly status: IikoFulfillmentOrderStatus;
}

export interface IikoFulfillmentProvider {
  createOrder(input: IikoFulfillmentCreateInput): Promise<IikoFulfillmentCreateResult>;
  getCommandStatus(commandId: string): Promise<IikoFulfillmentCommandResult>;
  getOrder(input: {
    readonly providerOrderId: string;
    readonly expectedTotalMinor: number;
  }): Promise<IikoFulfillmentOrderResult>;
}

export interface IikoFulfillmentProviderOptions {
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

export class IikoFulfillmentProviderError extends Error {
  readonly kind: "retryable" | "terminal";
  readonly code: string;

  constructor(kind: "retryable" | "terminal", code: string) {
    super("iiko fulfillment request failed");
    this.name = "IikoFulfillmentProviderError";
    this.kind = kind;
    this.code = code;
  }
}

function providerError(
  kind: IikoFulfillmentProviderError["kind"],
  code: string
): IikoFulfillmentProviderError {
  const safeCode =
    code.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 80) || "provider_error";
  return new IikoFulfillmentProviderError(kind, safeCode);
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_IIKO_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw providerError("terminal", "invalid_timeout");
  }
  return value;
}

function endpoint(config: IikoFulfillmentConfig, path: string): string {
  return `${config.baseUrl}${path}`;
}

async function postJson(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  body: unknown,
  token: string | null,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.resolve()
    .then(() =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token === null ? {} : { Authorization: `Bearer ${token}` })
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    )
    .then(async (response) => {
      const bodyText = await response.text();
      if (!response.ok) {
        const kind = response.status === 408 || response.status === 429 || response.status >= 500
          ? "retryable"
          : "terminal";
        throw providerError(kind, `http_${response.status}`);
      }
      try {
        return JSON.parse(bodyText) as unknown;
      } catch {
        throw providerError("terminal", "malformed_json");
      }
    });
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(providerError("retryable", "timeout"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } catch (error: unknown) {
    if (error instanceof IikoFulfillmentProviderError) throw error;
    throw providerError("retryable", timedOut ? "timeout" : "connection_error");
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function minorToIikoAmount(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw providerError("terminal", "invalid_money");
  }
  const amount = amountMinor / 100;
  if (!Number.isFinite(amount)) throw providerError("terminal", "invalid_money");
  return amount;
}

function itemPayload(item: IikoDispatchOrderItem): Record<string, unknown> {
  if (item.iikoProductId === null || item.iikoProductId.trim() === "") {
    throw providerError("terminal", "missing_mapping_snapshot");
  }
  if (
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 1 ||
    !Number.isSafeInteger(item.unitPriceMinor) ||
    item.unitPriceMinor < 0 ||
    item.lineTotalMinor !== item.unitPriceMinor * item.quantity
  ) {
    throw providerError("terminal", "malformed_order_snapshot");
  }
  return {
    type: "Product",
    amount: item.quantity,
    productId: item.iikoProductId,
    price: minorToIikoAmount(item.unitPriceMinor),
    modifiers: []
  };
}

function ensureExpectedProviderOrder(
  order: IikoOrderResultLike,
  expectedOrganizationId: string,
  expectedOrderId: string,
  expectedTotalMinor: number
): void {
  if (
    order.id !== expectedOrderId ||
    order.organizationId !== expectedOrganizationId ||
    order.order.sum !== minorToIikoAmount(expectedTotalMinor)
  ) {
    throw providerError("terminal", "provider_order_mismatch");
  }
}

interface IikoOrderResultLike {
  readonly id: string;
  readonly organizationId: string;
  readonly order: { readonly status: IikoFulfillmentOrderStatus; readonly sum: number };
}

function mapOrderResult(
  order: IikoOrderResultLike,
  expectedOrganizationId: string,
  expectedOrderId: string,
  expectedTotalMinor: number
): IikoFulfillmentOrderResult {
  ensureExpectedProviderOrder(
    order,
    expectedOrganizationId,
    expectedOrderId,
    expectedTotalMinor
  );
  return { providerOrderId: order.id, status: order.order.status };
}

export function createIikoFulfillmentProvider(
  config: IikoFulfillmentConfig,
  options: IikoFulfillmentProviderOptions = {}
): IikoFulfillmentProvider {
  const fetchImpl =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const timeoutMs = resolveTimeout(options.timeoutMs);

  let tokenPromise: Promise<string> | null = null;
  const getToken = async (): Promise<string> => {
    if (tokenPromise === null) {
      tokenPromise = postJson(
        fetchImpl,
        endpoint(config, "/api/v2/access_token"),
        { apiKey: config.apiKey, appId: config.appId, clientSecret: config.clientSecret },
        null,
        timeoutMs
      )
        .then((raw) => {
          const parsed = IikoTokenResponseSchema.safeParse(raw);
          if (!parsed.success) throw providerError("terminal", "invalid_token_response");
          return parsed.data.token;
        })
        .catch((error: unknown) => {
          tokenPromise = null;
          throw error;
        });
    }
    return tokenPromise as Promise<string>;
  };

  const withToken = async (path: string, body: unknown): Promise<unknown> =>
    postJson(fetchImpl, endpoint(config, path), body, await getToken(), timeoutMs);

  const getOrder = async (input: {
    readonly providerOrderId: string;
    readonly expectedTotalMinor: number;
  }): Promise<IikoFulfillmentOrderResult> => {
    const raw = await withToken("/api/1/deliveries/by_id", {
      organizationId: config.organizationId,
      orderIds: [input.providerOrderId]
    });
    const parsed = IikoOrdersResponseSchema.safeParse(raw);
    if (!parsed.success) throw providerError("terminal", "invalid_order_response");
    if (parsed.data.orders.length !== 1) {
      throw providerError("terminal", "provider_order_not_found");
    }
    const order = parsed.data.orders[0];
    if (order === undefined) throw providerError("terminal", "provider_order_not_found");
    return mapOrderResult(
      { id: order.id, organizationId: order.organizationId, order: order.order },
      config.organizationId,
      input.providerOrderId,
      input.expectedTotalMinor
    );
  };

  return {
    async createOrder(input) {
      const raw = await withToken("/api/1/deliveries/create", {
        organizationId: config.organizationId,
        terminalGroupId: config.terminalGroupId,
        order: {
          id: input.correlationId,
          externalNumber: `VPZH-${input.order.order.id}`,
          sourceKey: `vpzh-order-${input.order.order.id}`,
          phone: input.order.customer.phone,
          orderTypeId: config.orderTypeId,
          orderServiceType: "DeliveryByClient",
          customer: { type: "regular", name: input.order.customer.name },
          items: input.order.items.map(itemPayload),
          payments: [
            {
              paymentTypeKind: "External",
              sum: minorToIikoAmount(input.order.order.totalMinor),
              paymentTypeId: config.paymentTypeId,
              isProcessedExternally: true
            }
          ]
        }
      });
      const parsed = IikoCreateResponseSchema.safeParse(raw);
      if (!parsed.success) throw providerError("terminal", "invalid_create_response");
      const info = parsed.data.orderInfo;
      if (info.id !== input.correlationId) {
        throw providerError("terminal", "provider_order_mismatch");
      }
      if (info.creationStatus === "Error") {
        const code = info.errorInfo?.code ?? "provider_rejected";
        if (code !== "DuplicatedOrderId") {
          throw providerError("terminal", `provider_rejected_${code}`);
        }
        const recovered = await getOrder({
            providerOrderId: input.correlationId,
            expectedTotalMinor: input.order.order.totalMinor
          });
        return {
          providerOrderId: recovered.providerOrderId,
          commandId: null,
          state: "submitted" as const
        };
      }
      return {
        providerOrderId: info.id,
        commandId: info.creationStatus === "InProgress" ? parsed.data.correlationId : null,
        state: info.creationStatus === "InProgress" ? "command_pending" : "submitted"
      };
    },

    async getCommandStatus(commandId) {
      const raw = await withToken("/api/1/commands/status", {
        organizationId: config.organizationId,
        correlationId: commandId
      });
      const parsed = IikoCommandResponseSchema.safeParse(raw);
      if (!parsed.success) throw providerError("terminal", "invalid_command_response");
      if (parsed.data.state === "Error") {
        throw providerError("terminal", "command_failed");
      }
      return { state: parsed.data.state === "Success" ? "succeeded" : "pending" };
    },

    getOrder
  };
}

export function createUnavailableIikoFulfillmentProvider(): IikoFulfillmentProvider {
  const unavailable = (): never => {
    throw providerError("terminal", "iiko_not_configured");
  };
  return {
    createOrder: async () => unavailable(),
    getCommandStatus: async () => unavailable(),
    getOrder: async () => unavailable()
  };
}

export function createIikoFulfillmentProviderFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: IikoFulfillmentProviderOptions = {}
): IikoFulfillmentProvider {
  const config = loadIikoFulfillmentConfig(env);
  return config === null
    ? createUnavailableIikoFulfillmentProvider()
    : createIikoFulfillmentProvider(config, options);
}
