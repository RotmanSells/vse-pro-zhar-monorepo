import { describe, expect, it } from "vitest";

import {
  PaymentCreateRequestSchema,
  PaymentStateResponseSchema,
  PaymentSummarySchema,
  YooKassaPaymentObjectSchema,
  YooKassaWebhookPayloadSchema
} from "../src/index.js";

const providerPayment = {
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

describe("payment contracts", () => {
  it("accepts strict customer payment state and rejects client-authoritative fields", () => {
    expect(PaymentCreateRequestSchema.parse({})).toEqual({});
    expect(() => PaymentCreateRequestSchema.parse({ amountMinor: 1 })).toThrow();
    expect(
      PaymentStateResponseSchema.parse({
        order: { id: 7, status: "pending_payment" },
        payment: {
          id: 1,
          orderId: 7,
          provider: "yookassa",
          status: "pending",
          providerStatus: "pending",
          amountMinor: 45_050,
          currency: "RUB",
          confirmation: {
            type: "redirect",
            url: "https://yoomoney.ru/checkout/example"
          },
          createdAt: "2026-09-01T07:00:00.000Z",
          updatedAt: "2026-09-01T07:00:00.000Z"
        }
      })
    ).toBeTruthy();
    expect(() => PaymentSummarySchema.parse({
      id: 1,
      orderId: 7,
      provider: "yookassa",
      status: "pending",
      providerStatus: "pending",
      amountMinor: 45_050,
      currency: "RUB",
      confirmation: null,
      createdAt: "2026-09-01T07:00:00.000Z",
      updatedAt: "2026-09-01T07:00:00.000Z",
      providerPaymentId: "must-not-be-client-authoritative"
    })).toThrow();
  });

  it("validates the provider core response and strict webhook envelope", () => {
    expect(YooKassaPaymentObjectSchema.parse(providerPayment)).toEqual(providerPayment);
    expect(
      YooKassaWebhookPayloadSchema.parse({
        type: "notification",
        event: "payment.succeeded",
        object: providerPayment
      })
    ).toBeTruthy();
    expect(() => YooKassaPaymentObjectSchema.parse({ ...providerPayment, test: false })).not.toThrow();
    expect(() => YooKassaPaymentObjectSchema.parse({ ...providerPayment, unexpected: true })).toThrow();
  });
});
