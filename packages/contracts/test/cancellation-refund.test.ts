import { describe, expect, it } from "vitest";

import {
  CancellationRequestSchema,
  CustomerCancellationRefundSchema,
  RefundSummarySchema,
  YooKassaRefundObjectSchema
} from "../src/index.js";

describe("cancellation and refund contracts", () => {
  it("accepts only an empty cancellation request", () => {
    expect(CancellationRequestSchema.parse({})).toEqual({});
    expect(() => CancellationRequestSchema.parse({ amountMinor: 1 })).toThrow();
    expect(() => CancellationRequestSchema.parse({ paymentId: "provider-id" })).toThrow();
  });

  it("requires explicit safe customer refund state", () => {
    expect(CustomerCancellationRefundSchema.parse({
      cancellation: null,
      refund: {
        status: "pending",
        amountMinor: 45_050,
        currency: "RUB",
        attemptedAt: null,
        lastConfirmedAt: null,
        lastErrorCode: null
      },
      canCancel: false,
      canReconcile: false
    })).toMatchObject({ refund: { amountMinor: 45_050, currency: "RUB" } });
    expect(() => RefundSummarySchema.parse({ status: "succeeded", amountMinor: 1, currency: "USD", attemptedAt: null, lastConfirmedAt: null, lastErrorCode: null, providerPayload: {} })).toThrow();
  });

  it("strictly validates the provider refund core", () => {
    expect(YooKassaRefundObjectSchema.parse({
      id: "refund-1",
      status: "succeeded",
      amount: { value: "450.50", currency: "RUB" },
      created_at: "2026-09-01T07:00:00.000Z",
      payment_id: "payment-1",
      metadata: {}
    }).payment_id).toBe("payment-1");
    expect(() => YooKassaRefundObjectSchema.parse({
      id: "refund-1",
      status: "succeeded",
      amount: { value: "450.50", currency: "RUB" },
      created_at: "2026-09-01T07:00:00.000Z",
      payment_id: "payment-1",
      secret: "must-not-be-accepted"
    })).toThrow();
  });
});
