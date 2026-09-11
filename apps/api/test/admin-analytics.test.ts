import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdminAnalyticsRepository, AdminAnalyticsRepositoryResult, AdminAnalyticsWindowResult } from "@vse-pro-zhar/database";
import { AdminAnalyticsResponseSchema, ApiErrorSchema } from "@vse-pro-zhar/contracts";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

const now = new Date("2026-09-01T10:00:00.000Z");

function windowResult(overrides: Partial<AdminAnalyticsWindowResult> = {}): AdminAnalyticsWindowResult {
  return {
    orders: 2,
    revenueMinor: 100_000,
    qualifyingOrders: 1,
    customers: 1,
    reconciliationRequired: false,
    revenueByDay: [{ date: "2026-09-01", revenueMinor: 100_000 }],
    topDishes: [{ productId: 1, name: "Шашлык", quantity: 2, revenueMinor: 100_000 }],
    statuses: [{ status: "completed", count: 1 }, { status: "pending_payment", count: 1 }],
    pickupOrders: 2,
    recentOrders: [{ id: 1, customerName: "Анна", totalMinor: 100_000, status: "completed", createdAt: now }],
    ...overrides
  };
}

function repository(): AdminAnalyticsRepository {
  const result: AdminAnalyticsRepositoryResult = {
    current: windowResult(),
    previous: windowResult({ orders: 1, revenueMinor: 50_000, qualifyingOrders: 1, customers: 1, pickupOrders: 1 }),
    categories: { status: "unavailable", reason: "historical_snapshot_missing", items: [] }
  };
  return { read: async () => result };
}

describe("Admin analytics API", () => {
  let app: FastifyInstance;
  let staff: Awaited<ReturnType<typeof createMemoryStaffRepository>>;

  beforeEach(async () => {
    staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => now, staffRepository: staff.repository, analyticsRepository: repository() });
  });

  afterEach(async () => { await app.close(); });

  it("requires staff auth, validates period and returns server-owned aggregates", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/analytics?days=7" })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/analytics?days=7", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(AdminAnalyticsResponseSchema.parse(response.json())).toMatchObject({ period: 7, kpi: { revenueMinor: 100_000, averageCheckMinor: 100_000 }, categories: { status: "unavailable" } });
    expect(JSON.stringify(response.json())).not.toContain("provider");
    expect((await app.inject({ method: "GET", url: "/admin/analytics?days=8", headers: { cookie } })).statusCode).toBe(400);
  });

  it("generates bounded aggregate-only CSV through the protected boundary", async () => {
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/analytics/export?days=30", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().metadata.filename).toBe("admin-analytics-30-days-2026-08-03.csv");
    expect(response.json().content).toContain("Выручка");
    expect(response.json().content).not.toContain("Анна");
    expect(ApiErrorSchema.safeParse(response.json()).success).toBe(false);
  });
});
