import type { AdminPromoRepository, AdminPromoRepositoryRow } from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdminPromosResponseSchema, ApiErrorSchema } from "@vse-pro-zhar/contracts";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

function row(overrides: Partial<AdminPromoRepositoryRow> = {}): AdminPromoRepositoryRow {
  const now = new Date("2026-09-01T10:00:00.000Z");
  return {
    id: 1,
    code: "FIRE500",
    description: "Скидка 500 ₽",
    type: "fixed",
    value: 50_000,
    minimumOrderMinor: 200_000,
    currency: "RUB",
    activeFrom: now,
    activeUntil: null,
    globalUsageLimit: null,
    perCustomerUsageLimit: null,
    stackingPolicy: "none",
    status: "active",
    version: 1,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function repository(): AdminPromoRepository {
  let current = row();
  return {
    list: async () => ({ rows: [current], total: 1 }),
    get: async (id) => id === current.id ? current : null,
    listRedemptions: async (id) => id === current.id ? { promoId: current.id, promoCode: current.code, rows: [], total: 0 } : null,
    create: async (input) => { current = row({ code: input.code, description: input.description, type: input.type, value: input.value, minimumOrderMinor: input.minimumOrderMinor }); return current; },
    update: async (_id, input) => { current = row({ ...current, ...(input.description === undefined ? {} : { description: input.description }), ...(input.type === undefined ? {} : { type: input.type }), ...(input.value === undefined ? {} : { value: input.value }), ...(input.minimumOrderMinor === undefined ? {} : { minimumOrderMinor: input.minimumOrderMinor }), status: input.isActive === false ? "inactive" : current.status, version: current.version + 1 }); return current; },
    setActive: async (_id, active) => { current = row({ ...current, status: active ? "active" : "inactive", version: current.version + 1 }); return current; },
    archive: async () => { current = row({ ...current, status: "archived", version: current.version + 1 }); return current; }
  };
}

describe("Admin promos API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, staffRepository: staff.repository, adminPromoRepository: repository(), now: () => new Date("2026-09-01T10:00:00.000Z") });
  });

  afterEach(async () => { await app.close(); });

  it("protects list and exposes server-owned usage and unavailable checkout state", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/promos" })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/promos?limit=50&offset=0", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(AdminPromosResponseSchema.parse(response.json())).toMatchObject({ promos: [{ code: "FIRE500", usageCount: 0 }], customerCheckout: { status: "unavailable" } });
    const audit = await app.inject({ method: "GET", url: "/admin/promos/1/redemptions?limit=50&offset=0", headers: { cookie } });
    expect(audit.statusCode).toBe(200);
    expect(audit.json()).toMatchObject({ promoCode: "FIRE500", redemptions: [], pagination: { total: 0 } });
  });

  it("supports create, activate/deactivate and archive without destructive delete", async () => {
    const cookie = await staffCookie(app);
    const created = await app.inject({ method: "POST", url: "/admin/promos", headers: { cookie }, payload: { code: "spark10", type: "percent", value: 10, description: "Скидка", minimumOrderMinor: 0 } });
    expect(created.statusCode).toBe(201);
    expect(created.json().promo.code).toBe("SPARK10");
    expect((await app.inject({ method: "POST", url: "/admin/promos/1/deactivate", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/admin/promos/1/archive", headers: { cookie } })).statusCode).toBe(200);
  });

  it("rejects malformed economics and unknown fields", async () => {
    const cookie = await staffCookie(app);
    const invalid = await app.inject({ method: "POST", url: "/admin/promos", headers: { cookie }, payload: { code: "COAL100", type: "coal", value: 100, fakeUsageCount: 42 } });
    expect(invalid.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(invalid.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
