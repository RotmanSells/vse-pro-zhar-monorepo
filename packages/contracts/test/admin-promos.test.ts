import { describe, expect, it } from "vitest";

import {
  AdminPromoCreateRequestSchema,
  AdminPromoSchema,
  AdminPromoRedemptionsResponseSchema,
  AdminPromosQuerySchema,
  AdminPromoUpdateRequestSchema
} from "../src/admin-promos.js";

describe("admin promo contracts", () => {
  it("normalizes codes and keeps promo economics integer-safe", () => {
    const parsed = AdminPromoCreateRequestSchema.parse({ code: " spark10 ", type: "percent", value: 10, description: "Скидка", minimumOrderMinor: 0 });
    expect(parsed.code).toBe("SPARK10");
    expect(parsed.currency).toBe("RUB");
    expect(AdminPromoCreateRequestSchema.safeParse({ code: "COAL100", type: "coal", value: 100 }).success).toBe(false);
    expect(AdminPromoCreateRequestSchema.safeParse({ code: "HALF", type: "percent", value: 100.5 }).success).toBe(false);
    expect(AdminPromoCreateRequestSchema.safeParse({ code: "HALF", type: "percent", value: 101 }).success).toBe(false);
    expect(AdminPromoCreateRequestSchema.safeParse({ code: "BAD CODE", type: "fixed", value: 100 }).success).toBe(false);
    expect(AdminPromoCreateRequestSchema.safeParse({ code: "UNKNOWN", type: "fixed", value: 100, total: 1_000 }).success).toBe(false);
  });

  it("rejects invalid periods and update payloads", () => {
    expect(AdminPromoCreateRequestSchema.safeParse({ code: "LATE", type: "fixed", value: 100, activeFrom: "2026-09-02T00:00:00.000Z", activeUntil: "2026-09-01T00:00:00.000Z" }).success).toBe(false);
    expect(AdminPromoUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(AdminPromoUpdateRequestSchema.safeParse({ type: "percent", value: 100 }).success).toBe(true);
    expect(AdminPromosQuerySchema.parse({ limit: "50", offset: "0", search: " fire " })).toEqual({ limit: 50, offset: 0, search: "fire" });
  });

  it("accepts only confirmed server-owned response fields", () => {
    expect(AdminPromoSchema.safeParse({
      id: 1,
      code: "FIRE500",
      description: "Скидка",
      type: "fixed",
      value: 50_000,
      minimumOrderMinor: 200_000,
      currency: "RUB",
      activeFrom: "2026-09-01T00:00:00.000Z",
      activeUntil: null,
      globalUsageLimit: null,
      perCustomerUsageLimit: null,
      stackingPolicy: "none",
      status: "active",
      version: 1,
      usageCount: 0,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    }).success).toBe(true);
  });

  it("keeps redemption audit bounded and free of source secrets", () => {
    expect(AdminPromoRedemptionsResponseSchema.parse({ status: "confirmed", promoId: 1, promoCode: "FIRE500", redemptions: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }).redemptions).toHaveLength(0);
    expect(AdminPromoRedemptionsResponseSchema.safeParse({ status: "confirmed", promoId: 1, promoCode: "FIRE500", redemptions: [{ id: 1, customerId: 2, orderId: 3, discountMinor: 100, preDiscountTotalMinor: 1_000, finalTotalMinor: 900, currency: "RUB", status: "succeeded", createdAt: "2026-09-01T00:00:00.000Z", sourceKey: "secret" }], pagination: { limit: 50, offset: 0, total: 1, hasNext: false } }).success).toBe(false);
  });
});
