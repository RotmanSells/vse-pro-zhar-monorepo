import { describe, expect, it, vi } from "vitest";

import {
  createYooKassaProvider,
  YooKassaProviderError
} from "../src/payments/provider.js";
import {
  loadYooKassaConfig,
  YooKassaConfigurationError
} from "../src/payments/config.js";

const payment = {
  id: "yk-payment-1",
  status: "pending",
  paid: false,
  amount: { value: "450.50", currency: "RUB" },
  created_at: "2026-09-01T07:00:00.000Z",
  metadata: { order_id: "7" },
  confirmation: {
    type: "redirect",
    confirmation_url: "https://yoomoney.ru/checkout/example"
  },
  test: true
};

const refund = {
  id: "yk-refund-1",
  status: "succeeded",
  amount: { value: "450.50", currency: "RUB" },
  created_at: "2026-09-01T07:10:00.000Z",
  payment_id: "yk-payment-1",
  description: "Возврат заказа №7",
  metadata: {}
};

function config() {
  return loadYooKassaConfig({
    YOOKASSA_SHOP_ID: "123456",
    YOOKASSA_SECRET_KEY: "s".repeat(32),
    YOOKASSA_TEST_MODE: "true"
  });
}

describe("YooKassa card adapter", () => {
  it("sends the official card create shape with Basic auth and idempotency", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify(payment));
    });
    const loadedConfig = config();
    if (loadedConfig === null) throw new Error("Expected test config");
    const provider = createYooKassaProvider(loadedConfig, { fetchImpl });

    const result = await provider.createPayment({
      orderId: 7,
      amountMinor: 45_050,
      currency: "RUB",
      idempotencyKey: "provider-idempotency"
    });

    expect(result).toMatchObject({
      providerPaymentId: "yk-payment-1",
      providerStatus: "pending",
      amountMinor: 45_050,
      currency: "RUB",
      confirmationUrl: "https://yoomoney.ru/checkout/example",
      test: true
    });
    const call = fetchImpl.mock.calls[0];
    if (call === undefined) throw new Error("Expected provider request");
    const init = call[1];
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(call[0]).toBe("https://api.yookassa.ru/v3/payments");
    expect(headers["Idempotence-Key"]).toBe("provider-idempotency");
    expect(headers["Authorization"]).toMatch(/^Basic /u);
    expect(headers["Authorization"]).not.toContain("s".repeat(32));
    expect(body).toMatchObject({
      amount: { value: "450.50", currency: "RUB" },
      payment_method_data: { type: "bank_card" },
      confirmation: {
        type: "redirect",
        return_url: "http://localhost:8082/payment/return"
      },
      capture: true,
      metadata: { order_id: "7" }
    });
  });

  it("fails closed for masked credentials and live/malformed provider responses", async () => {
    expect(() => loadYooKassaConfig({
      YOOKASSA_SHOP_ID: "123456",
      YOOKASSA_SECRET_KEY: "********"
    })).toThrow(YooKassaConfigurationError);

    const loadedConfig = config();
    if (loadedConfig === null) throw new Error("Expected test config");
    const liveProvider = createYooKassaProvider(loadedConfig, {
      fetchImpl: async () => new Response(JSON.stringify({ ...payment, test: false }))
    });
    await expect(liveProvider.createPayment({
      orderId: 7,
      amountMinor: 45_050,
      currency: "RUB",
      idempotencyKey: "provider-idempotency"
    })).rejects.toMatchObject({ kind: "invalid_response" });

    const malformedProvider = createYooKassaProvider(loadedConfig, {
      fetchImpl: async () => new Response("not-json")
    });
    await expect(malformedProvider.getPayment("yk-payment-1"))
      .rejects.toBeInstanceOf(YooKassaProviderError);
  });

  it("accepts a test secret containing a literal asterisk", () => {
    expect(loadYooKassaConfig({
      YOOKASSA_SHOP_ID: "518587",
      YOOKASSA_SECRET_KEY: "test_*ghgDFUwE2QrJZPSc-5EOnoV3yj5VLHz3eAXAl5H0RpxE",
      YOOKASSA_TEST_MODE: "true"
    })).toMatchObject({
      shopId: "518587",
      testMode: true
    });
  });

  it("keeps safe provider diagnostics for a rejected request", async () => {
    const loadedConfig = config();
    if (loadedConfig === null) throw new Error("Expected test config");
    const provider = createYooKassaProvider(loadedConfig, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            type: "error",
            id: "provider-error-id",
            code: "invalid_request",
            description: "Return URL is not allowed",
            parameter: "confirmation.return_url"
          }),
          {
            status: 400,
            headers: { "X-Request-ID": "provider-request-id" }
          }
        )
    });

    await expect(provider.createPayment({
      orderId: 7,
      amountMinor: 45_050,
      currency: "RUB",
      idempotencyKey: "provider-idempotency"
    })).rejects.toMatchObject({
      kind: "unavailable",
      details: {
        httpStatus: 400,
        providerErrorId: "provider-error-id",
        providerCode: "invalid_request",
        providerDescription: "Return URL is not allowed",
        providerParameter: "confirmation.return_url",
        providerRequestId: "provider-request-id"
      }
    });
  });

  it("creates and polls a full refund with the persisted provider payment reference", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: input, init });
      return new Response(JSON.stringify(refund));
    });
    const loadedConfig = config();
    if (loadedConfig === null) throw new Error("Expected test config");
    const provider = createYooKassaProvider(loadedConfig, { fetchImpl });

    await expect(provider.createRefund({
      orderId: 7,
      paymentProviderId: "yk-payment-1",
      amountMinor: 45_050,
      currency: "RUB",
      idempotencyKey: "refund-idempotency"
    })).resolves.toEqual({
      providerRefundId: "yk-refund-1",
      providerStatus: "succeeded",
      paymentProviderId: "yk-payment-1",
      amountMinor: 45_050,
      currency: "RUB"
    });
    await expect(provider.getRefund("yk-refund-1")).resolves.toMatchObject({ providerRefundId: "yk-refund-1" });
    const createCall = calls[0];
    if (createCall === undefined) throw new Error("Expected refund create call");
    expect(createCall.url).toBe("https://api.yookassa.ru/v3/refunds");
    expect((createCall.init?.headers as Record<string, string>)["Idempotence-Key"]).toBe("refund-idempotency");
    expect(JSON.parse(String(createCall.init?.body))).toEqual({
      payment_id: "yk-payment-1",
      amount: { value: "450.50", currency: "RUB" },
      description: "Возврат заказа №7"
    });
    expect(JSON.stringify(createCall.init?.body)).not.toContain("receipt");
    expect(calls[1]?.url).toBe("https://api.yookassa.ru/v3/refunds/yk-refund-1");
  });
});
