import { describe, expect, it } from "vitest";

import { CustomerProfileResponseSchema } from "../src/profile.js";

const base = {
  customer: { phone: "+79991234567", name: "Анна", birthDate: null },
  stats: { orderCount: 0, favoriteProduct: null, nextMilestone: null },
  loyalty: { status: "unavailable", reason: "not_configured" },
  settings: {
    pushNotifications: { status: "unavailable", reason: "native_push_contract_pending" },
    emailSubscription: { status: "unavailable", reason: "email_consent_contract_pending" },
    darkTheme: { status: "unavailable", reason: "theme_contract_pending" }
  },
  recentOrders: []
};

describe("customer profile contract", () => {
  it("accepts empty nullable states and rejects client-side business fields", () => {
    expect(CustomerProfileResponseSchema.safeParse(base).success).toBe(true);
    expect(CustomerProfileResponseSchema.safeParse({ ...base, stats: { ...base.stats, orderCount: 1.5 } }).success).toBe(false);
    expect(CustomerProfileResponseSchema.safeParse({ ...base, stats: { ...base.stats, balance: 450 } }).success).toBe(false);
    expect(CustomerProfileResponseSchema.safeParse({ ...base, session: { token: "secret" } }).success).toBe(false);
  });

  it("requires a bounded server-owned milestone shape and truthful setting reason", () => {
    expect(CustomerProfileResponseSchema.safeParse({
      ...base,
      stats: { orderCount: 1, favoriteProduct: "Шашлык", nextMilestone: { label: "До ранга", remaining: 550, unit: "xp", source: "loyalty_rank" } }
    }).success).toBe(true);
    expect(CustomerProfileResponseSchema.safeParse({
      ...base,
      stats: { ...base.stats, nextMilestone: { label: "До ранга", remaining: -1, unit: "xp", source: "loyalty_rank" } }
    }).success).toBe(false);
    expect(CustomerProfileResponseSchema.safeParse({
      ...base,
      settings: { ...base.settings, darkTheme: { status: "enabled", reason: "theme_contract_pending" } }
    }).success).toBe(false);
  });
});
