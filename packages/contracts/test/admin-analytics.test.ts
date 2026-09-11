import { describe, expect, it } from "vitest";

import {
  AdminAnalyticsPeriodSchema,
  AdminAnalyticsResponseSchema
} from "../src/admin-analytics.js";

describe("admin analytics contracts", () => {
  it("accepts only bounded integer periods", () => {
    expect(AdminAnalyticsPeriodSchema.safeParse(7).success).toBe(true);
    expect(AdminAnalyticsPeriodSchema.safeParse(30).success).toBe(true);
    expect(AdminAnalyticsPeriodSchema.safeParse(90).success).toBe(true);
    expect(AdminAnalyticsPeriodSchema.safeParse(7.5).success).toBe(false);
    expect(AdminAnalyticsPeriodSchema.safeParse(8).success).toBe(false);
    expect(AdminAnalyticsPeriodSchema.safeParse(-7).success).toBe(false);
  });

  it("keeps null comparison and empty states explicit", () => {
    const parsed = AdminAnalyticsResponseSchema.safeParse({
      period: 7,
      timezone: "Europe/Moscow",
      range: { start: "2026-08-25T21:00:00.000Z", end: "2026-09-01T21:00:00.000Z" },
      comparisonRange: { start: "2026-08-18T21:00:00.000Z", end: "2026-08-25T21:00:00.000Z" },
      dataStatus: "empty",
      kpi: { revenueMinor: 0, orders: 0, averageCheckMinor: null, customers: 0, currency: "RUB" },
      comparison: { revenue: { percent: null }, orders: { percent: null }, averageCheck: { percent: null }, customers: { percent: null } },
      revenueByDay: [],
      topDishes: [],
      statuses: [],
      types: [],
      categories: { status: "unavailable", reason: "historical_snapshot_missing", items: [] },
      recentOrders: []
    });
    expect(parsed.success).toBe(true);
    expect(AdminAnalyticsResponseSchema.safeParse({ ...(parsed.success ? parsed.data : {}), kpi: { revenueMinor: 1.5, orders: 0, averageCheckMinor: null, customers: 0, currency: "RUB" } }).success).toBe(false);
  });
});
