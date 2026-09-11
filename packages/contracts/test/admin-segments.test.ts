import { describe, expect, it } from "vitest";

import {
  AdminCustomSegmentCriteriaSchema,
  AdminSegmentCriterionSchema,
  AdminSegmentPreviewQuerySchema
} from "../src/admin-segments.js";

describe("admin segments contracts", () => {
  it("accepts only strict integer criteria with matching units", () => {
    expect(AdminSegmentCriterionSchema.safeParse({ metric: "orders", operator: "gte", unit: "orders", value: 3 }).success).toBe(true);
    expect(AdminSegmentCriterionSchema.safeParse({ metric: "spend", operator: "gte", unit: "RUB_minor", value: 150_000 }).success).toBe(true);
    expect(AdminSegmentCriterionSchema.safeParse({ metric: "spend", operator: "gte", unit: "RUB", value: 150_000 }).success).toBe(false);
    expect(AdminSegmentCriterionSchema.safeParse({ metric: "orders", operator: "gte", unit: "orders", value: 1.5 }).success).toBe(false);
    expect(AdminSegmentCriterionSchema.safeParse({ metric: "orders", operator: "gte", unit: "orders", value: -1 }).success).toBe(false);
    expect(AdminSegmentCriterionSchema.safeParse({ metric: "orders", operator: "gte", unit: "orders", value: 3, sql: "SELECT 1" }).success).toBe(false);
  });

  it("limits custom criteria to the approved operator shape and preview bounds", () => {
    expect(AdminCustomSegmentCriteriaSchema.safeParse([{ metric: "orders", operator: "gte", unit: "orders", value: 3 }]).success).toBe(true);
    expect(AdminCustomSegmentCriteriaSchema.safeParse([{ metric: "orders", operator: "eq", unit: "orders", value: 3 }]).success).toBe(false);
    expect(AdminCustomSegmentCriteriaSchema.safeParse([{ metric: "orders", operator: "gte", unit: "orders", value: 3 }, { metric: "spend", operator: "gte", unit: "RUB_minor", value: 100 }]).success).toBe(false);
    expect(AdminSegmentPreviewQuerySchema.parse({ limit: "50", offset: "0" })).toEqual({ limit: 50, offset: 0 });
    expect(AdminSegmentPreviewQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(AdminSegmentPreviewQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });
});
