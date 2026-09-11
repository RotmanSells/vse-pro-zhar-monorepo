import { describe, expect, it } from "vitest";

import type { AdminAnalyticsResponse } from "@vse-pro-zhar/contracts";

import { createAdminAnalyticsRequestController } from "../src/admin-analytics-controller.js";
import type { AdminAnalyticsClient } from "../src/admin-analytics-client.js";

const response: AdminAnalyticsResponse = {
  period: 7,
  timezone: "Europe/Moscow",
  range: { start: "2026-08-25T21:00:00.000Z", end: "2026-09-01T21:00:00.000Z" },
  comparisonRange: { start: "2026-08-18T21:00:00.000Z", end: "2026-08-25T21:00:00.000Z" },
  dataStatus: "available",
  kpi: { revenueMinor: 100_000, orders: 2, averageCheckMinor: 50_000, customers: 1, currency: "RUB" },
  comparison: { revenue: { percent: 10 }, orders: { percent: 20 }, averageCheck: { percent: null }, customers: { percent: 0 } },
  revenueByDay: [{ date: "2026-09-01", revenueMinor: 100_000 }],
  topDishes: [{ productId: 1, name: "Шашлык", quantity: 2, revenueMinor: 100_000 }],
  statuses: [{ status: "completed", count: 2 }],
  types: [{ type: "pickup", count: 2 }],
  categories: { status: "unavailable", reason: "historical_snapshot_missing", items: [] },
  recentOrders: [{ id: 1, customerName: "Анна", totalMinor: 100_000, currency: "RUB", status: "completed", createdAt: "2026-09-01T10:00:00.000Z" }]
};

describe("admin analytics controller", () => {
  it("aborts stale period requests and keeps the newest response", async () => {
    const requests: Array<{ readonly days: number; readonly signal: AbortSignal | undefined; readonly resolve: (value: AdminAnalyticsResponse) => void }> = [];
    const client: AdminAnalyticsClient = {
      get: ({ days }, { signal } = {}) => new Promise<AdminAnalyticsResponse>((resolve) => { requests.push({ days, signal, resolve }); }),
      exportCsv: async () => ({ metadata: { filename: "admin-analytics-7-days-2026-08-25.csv", contentType: "text/csv; charset=utf-8", period: 7 }, content: "" })
    };
    const states: string[] = [];
    const controller = createAdminAnalyticsRequestController(client, (state) => { states.push(state.status); });
    controller.load(7);
    controller.load(30);
    requests[1]?.resolve({ ...response, period: 30 });
    await Promise.resolve();
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(states).toEqual(["loading", "loading", "success"]);
    controller.dispose();
  });
});
