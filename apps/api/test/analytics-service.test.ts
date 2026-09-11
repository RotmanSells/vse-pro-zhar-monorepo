import { describe, expect, it } from "vitest";

import type { AdminAnalyticsRepository, AdminAnalyticsRepositoryResult, AdminAnalyticsWindowResult } from "@vse-pro-zhar/database";

import { buildAdminAnalyticsExport, calculateAdminAnalyticsPeriod, getAdminAnalytics } from "../src/analytics/service.js";

const emptyWindow: AdminAnalyticsWindowResult = {
  orders: 0,
  revenueMinor: 0,
  qualifyingOrders: 0,
  customers: 0,
  reconciliationRequired: false,
  revenueByDay: [],
  topDishes: [],
  statuses: [],
  pickupOrders: 0,
  recentOrders: []
};

function repository(result: AdminAnalyticsRepositoryResult): AdminAnalyticsRepository {
  return { read: async () => result };
}

describe("admin analytics service", () => {
  it("builds exact Europe/Moscow calendar boundaries including the current day", () => {
    const period = calculateAdminAnalyticsPeriod(7, new Date("2026-09-01T10:00:00.000Z"));
    expect(period.current.start.toISOString()).toBe("2026-08-25T21:00:00.000Z");
    expect(period.current.end.toISOString()).toBe("2026-09-01T21:00:00.000Z");
    expect(period.previous.start.toISOString()).toBe("2026-08-18T21:00:00.000Z");
    expect(period.previous.end.toISOString()).toBe("2026-08-25T21:00:00.000Z");
  });

  it("fills missing daily points, keeps zero-baseline comparison null and sanitizes CSV cells", async () => {
    const current: AdminAnalyticsWindowResult = {
      ...emptyWindow,
      orders: 1,
      revenueMinor: 100_000,
      qualifyingOrders: 1,
      customers: 1,
      revenueByDay: [{ date: "2026-09-01", revenueMinor: 100_000 }],
      topDishes: [{ productId: 1, name: "=Опасное название", quantity: 1, revenueMinor: 100_000 }],
      statuses: [{ status: "completed", count: 1 }],
      pickupOrders: 1
    };
    const analytics = await getAdminAnalytics(repository({ current, previous: emptyWindow, categories: { status: "unavailable", reason: "historical_snapshot_missing", items: [] } }), 7, new Date("2026-09-01T10:00:00.000Z"));
    expect(analytics.revenueByDay).toHaveLength(7);
    expect(analytics.revenueByDay[0]).toEqual({ date: "2026-08-26", revenueMinor: 0 });
    expect(analytics.comparison.revenue.percent).toBeNull();
    expect(analytics.kpi.averageCheckMinor).toBe(100_000);
    expect(buildAdminAnalyticsExport(analytics).content).toContain("'=Опасное название");
  });

  it("returns explicit empty and null average states without inventing business facts", async () => {
    const analytics = await getAdminAnalytics(repository({ current: emptyWindow, previous: emptyWindow, categories: { status: "unavailable", reason: "historical_snapshot_missing", items: [] } }), 30, new Date("2026-09-01T10:00:00.000Z"));
    expect(analytics.dataStatus).toBe("empty");
    expect(analytics.kpi.averageCheckMinor).toBeNull();
    expect(analytics.comparison.averageCheck.percent).toBeNull();
  });
});
