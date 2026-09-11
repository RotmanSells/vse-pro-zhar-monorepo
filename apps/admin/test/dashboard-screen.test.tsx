import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminAnalyticsClient } from "@vse-pro-zhar/api-client";
import type { AdminAnalyticsResponse } from "@vse-pro-zhar/contracts";

import { DashboardScreen } from "../src/components/dashboard-screen";

const analytics: AdminAnalyticsResponse = {
  period: 30,
  timezone: "Europe/Moscow",
  range: { start: "2026-08-02T21:00:00.000Z", end: "2026-09-01T21:00:00.000Z" },
  comparisonRange: { start: "2026-07-03T21:00:00.000Z", end: "2026-08-02T21:00:00.000Z" },
  dataStatus: "available",
  kpi: { revenueMinor: 125_050, orders: 4, averageCheckMinor: 31_262, customers: 3, currency: "RUB" },
  comparison: { revenue: { percent: 12.5 }, orders: { percent: -5 }, averageCheck: { percent: null }, customers: { percent: 0 } },
  revenueByDay: [{ date: "2026-09-01", revenueMinor: 125_050 }],
  topDishes: [{ productId: 1, name: "Шашлык из свинины", quantity: 3, revenueMinor: 90_000 }],
  statuses: [{ status: "completed", count: 4 }],
  types: [{ type: "pickup", count: 4 }],
  categories: { status: "unavailable", reason: "historical_snapshot_missing", items: [] },
  recentOrders: [{ id: 42, customerName: "Анна", totalMinor: 45_050, currency: "RUB", status: "completed", createdAt: "2026-09-01T10:00:00.000Z" }]
};

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Admin dashboard screen", () => {
  beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

  it("renders server values, truthful category state and reloads a selected period", async () => {
    const calls: number[] = [];
    const client: AdminAnalyticsClient = {
      get: async ({ days }) => { calls.push(days); return { ...analytics, period: days }; },
      exportCsv: async () => ({ metadata: { filename: "admin-analytics-30-days-2026-08-02.csv", contentType: "text/csv; charset=utf-8", period: 30 }, content: "" })
    };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<DashboardScreen client={client} />); await flush(); });
    if (renderer === null) throw new Error("Expected dashboard renderer");
    expect(text(renderer.root)).toContain("1 250,5₽");
    expect(text(renderer.root)).toContain("Исторические категории недоступны");
    const periodSelect = renderer.root.find((node) => node.props["aria-label"] === "Период аналитики");
    await act(async () => { periodSelect.props.onChange({ target: { value: "7" } }); await flush(); });
    expect(calls).toEqual([30, 7]);
    expect(text(renderer.root)).toContain("7 дней");
    await act(async () => { renderer?.unmount(); await flush(); });
  });
});
