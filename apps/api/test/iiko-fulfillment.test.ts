import { describe, expect, it } from "vitest";

import type { IikoDispatchOrder } from "@vse-pro-zhar/database";

import {
  createIikoFulfillmentProvider,
  IikoFulfillmentProviderError
} from "../src/iiko/fulfillment.js";
import {
  IikoFulfillmentConfigurationError,
  loadIikoFulfillmentConfig
} from "../src/iiko/config.js";

const organizationId = "3e41b6b4-9f43-4f65-8e5d-0c1c4c2f9a10";
const terminalGroupId = "4c6d5f37-bda2-4ed1-b48e-1b4fa7028f21";
const orderTypeId = "5c4d5e86-5f6c-46ae-8dd7-8e27b4ab1f31";
const paymentTypeId = "6a0d7c48-8f9e-4a12-9b33-4c5d6e7f8a41";
const productId = "10000000-0000-4000-8000-000000000001";
const correlationId = "90000000-0000-4000-8000-000000000099";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    IIKO_BASE_URL: "http://127.0.0.1:4010",
    IIKO_API_KEY: "vpzh-test-api-key",
    IIKO_APP_ID: "00000000-0000-4000-8000-000000000001",
    IIKO_CLIENT_SECRET: "vpzh-test-client-secret",
    IIKO_ORGANIZATION_ID: organizationId,
    IIKO_TERMINAL_GROUP_ID: terminalGroupId,
    IIKO_PRODUCT_MAPPING: JSON.stringify({ "1": productId }),
    IIKO_ORDER_TYPE_ID: orderTypeId,
    IIKO_PAYMENT_TYPE_ID: paymentTypeId,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createOrder(): IikoDispatchOrder {
  const now = new Date("2026-09-01T10:00:00.000Z");
  return {
    dispatch: {
      id: 1,
      orderId: 1,
      correlationId,
      providerOrderId: null,
      commandId: null,
      status: "creating",
      attemptCount: 0,
      nextAttemptAt: now,
      lastAttemptAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now
    },
    order: {
      id: 1,
      customerId: 1,
      pickupLocationId: "main-grill",
      pickupLocationName: "Основная точка",
      pickupLocationAddress: "Основная точка",
      pickupLocationTimezone: "Europe/Moscow",
      pickupSlotId: "slot-1",
      pickupSlotLabel: "Сегодня, 18:00–18:30",
      pickupSlotStartsAt: now,
      pickupSlotEndsAt: new Date(now.getTime() + 1_800_000),
      status: "payment_confirmed",
      totalMinor: 61_000,
      currency: "RUB",
      idempotencyKey: "order-1",
      payloadFingerprint: "a".repeat(64),
      createdAt: now,
      updatedAt: now
    },
    customer: { phone: "+79991234567", name: "Анна" },
    items: [
      {
        id: 1,
        orderId: 1,
        productId: 1,
        productName: "Шашлык",
        unitPriceMinor: 49_000,
        quantity: 1,
        lineTotalMinor: 49_000,
        iikoProductId: productId
      },
      {
        id: 2,
        orderId: 1,
        productId: 2,
        productName: "Сыр",
        unitPriceMinor: 12_000,
        quantity: 1,
        lineTotalMinor: 12_000,
        iikoProductId: "20000000-0000-4000-8000-000000000001"
      }
    ]
  };
}

function providerConfig() {
  const config = loadIikoFulfillmentConfig(environment());
  if (config === null) throw new Error("Expected fulfillment configuration");
  return config;
}

describe("iiko fulfillment configuration", () => {
  it("requires explicit order and payment mappings for write mode", () => {
    expect(
      loadIikoFulfillmentConfig(
        environment({ IIKO_ORDER_TYPE_ID: undefined, IIKO_PAYMENT_TYPE_ID: undefined })
      )
    ).toBeNull();
    expect(() =>
      loadIikoFulfillmentConfig(environment({ IIKO_PAYMENT_TYPE_ID: "not-an-id" }))
    ).toThrow(IikoFulfillmentConfigurationError);
  });
});

describe("iiko fulfillment provider", () => {
  it("creates and polls a pickup order using minor-unit snapshots", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const path = new URL(url).pathname;
      if (path === "/api/v2/access_token") {
        return jsonResponse({ correlationId: "token-correlation", token: "token" });
      }
      if (path === "/api/1/deliveries/create") {
        return jsonResponse({
          correlationId: "create-correlation",
          orderInfo: { id: correlationId, creationStatus: "Success", errorInfo: null }
        });
      }
      return jsonResponse({
        correlationId: "poll-correlation",
        orders: [
          {
            id: correlationId,
            organizationId,
            order: { status: "WaitCooking", sum: 610 }
          }
        ]
      });
    };
    const provider = createIikoFulfillmentProvider(providerConfig(), { fetchImpl });
    const created = await provider.createOrder({ order: createOrder(), correlationId });

    expect(created).toEqual({
      providerOrderId: correlationId,
      commandId: null,
      state: "submitted"
    });
    const payload = JSON.parse(String(calls[1]?.init.body)) as {
      order: { items: Array<{ price: number }>; payments: Array<{ sum: number }> };
    };
    expect(payload.order.items.map((item) => item.price)).toEqual([490, 120]);
    expect(payload.order.payments[0]?.sum).toBe(610);
    await expect(
      provider.getOrder({ providerOrderId: correlationId, expectedTotalMinor: 61_000 })
    ).resolves.toEqual({ providerOrderId: correlationId, status: "WaitCooking" });
  });

  it("recovers a duplicate order only after matching it by stable ID and amount", async () => {
    let createCalls = 0;
    const fetchImpl = async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/v2/access_token") {
        return jsonResponse({ correlationId: "token-correlation", token: "token" });
      }
      if (path === "/api/1/deliveries/create") {
        createCalls += 1;
        return jsonResponse({
          correlationId: "create-correlation",
          orderInfo: {
            id: correlationId,
            creationStatus: "Error",
            errorInfo: { code: "DuplicatedOrderId" }
          }
        });
      }
      return jsonResponse({
        correlationId: "poll-correlation",
        orders: [{ id: correlationId, organizationId, order: { status: "Unconfirmed", sum: 610 } }]
      });
    };
    const provider = createIikoFulfillmentProvider(providerConfig(), { fetchImpl });
    await expect(provider.createOrder({ order: createOrder(), correlationId })).resolves.toMatchObject({
      providerOrderId: correlationId,
      state: "submitted"
    });
    expect(createCalls).toBe(1);
  });

  it("classifies network retry and provider schema/mismatch failures safely", async () => {
    const retryProvider = createIikoFulfillmentProvider(providerConfig(), {
      fetchImpl: async (url) => {
        if (new URL(url).pathname === "/api/v2/access_token") {
          return jsonResponse({ correlationId: "token-correlation", token: "token" });
        }
        return jsonResponse({ error: "temporary" }, 503);
      }
    });
    await expect(retryProvider.createOrder({ order: createOrder(), correlationId })).rejects.toMatchObject({
      kind: "retryable",
      code: "http_503"
    });

    const mismatchProvider = createIikoFulfillmentProvider(providerConfig(), {
      fetchImpl: async (url) => {
        if (new URL(url).pathname === "/api/v2/access_token") {
          return jsonResponse({ correlationId: "token-correlation", token: "token" });
        }
        return jsonResponse({
          correlationId: "create-correlation",
          orderInfo: { id: "90000000-0000-4000-8000-000000000100", creationStatus: "Success" }
        });
      }
    });
    await expect(mismatchProvider.createOrder({ order: createOrder(), correlationId })).rejects.toMatchObject({
      kind: "terminal",
      code: "provider_order_mismatch"
    });
    expect(new IikoFulfillmentProviderError("terminal", "x")).toBeInstanceOf(Error);
  });
});
