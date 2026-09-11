import { describe, expect, it } from "vitest";

import { AdminCustomersQuerySchema, AdminCustomersResponseSchema } from "../src/admin-customers.js";

describe("admin customers contracts", () => {
  it("keeps pagination bounded and coerces query values", () => {
    expect(AdminCustomersQuerySchema.parse({ limit: "25", offset: "0", search: "Анна" })).toEqual({ limit: 25, offset: 0, search: "Анна" });
    expect(AdminCustomersQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(AdminCustomersQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it("allows nullable loyalty/activity values without accepting unknown fields", () => {
    const parsed = AdminCustomersResponseSchema.safeParse({
      status: "confirmed",
      customers: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234", orderCount: 0, spentMinor: 0, coalBalance: null, xp: null, rank: null, lastActivityAt: null }],
      pagination: { limit: 25, offset: 0, total: 1, hasNext: false }
    });
    expect(parsed.success).toBe(true);
    expect(AdminCustomersResponseSchema.safeParse({ ...(parsed.success ? parsed.data : {}), customers: [{ ...(parsed.success ? parsed.data.customers[0] : {}), phone: "+79991231234" }] }).success).toBe(false);
  });
});
