import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdminSegmentRepository } from "@vse-pro-zhar/database";
import { AdminSegmentPreviewResponseSchema, AdminSegmentsResponseSchema, ApiErrorSchema } from "@vse-pro-zhar/contracts";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

const builtinCodes = ["sleeping", "one_timer", "churned", "newbies", "regulars", "vip", "big_spenders", "coal_rich", "at_risk"] as const;

function repository(): AdminSegmentRepository {
  return {
    listBuiltinCounts: async () => builtinCodes.map((code, index) => ({ code, count: index, unavailableReason: null })),
    preview: async () => ({ rows: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234", orderCount: 3, spentMinor: 450_000, lastActivityAt: new Date("2026-09-01T08:00:00.000Z") }], total: 1, unavailableReason: null })
  };
}

describe("Admin segments API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, staffRepository: staff.repository, adminSegmentRepository: repository(), now: () => new Date("2026-09-01T10:00:00.000Z") });
  });

  afterEach(async () => { await app.close(); });

  it("requires staff auth and returns built-in counts from the protected route", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/segments" })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/segments", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(AdminSegmentsResponseSchema.parse(response.json()).builtins).toHaveLength(9);
    expect(response.json().customLifecycle).toEqual({ status: "unavailable", reason: "owner_decision_required" });
  });

  it("returns masked bounded preview and validates code/query", async () => {
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/segments/regulars?limit=50&offset=0", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(AdminSegmentPreviewResponseSchema.parse(response.json())).toMatchObject({ status: "confirmed", customers: [{ phoneMasked: "•••• 1234" }], pagination: { limit: 50 } });
    expect(JSON.stringify(response.json())).not.toContain("+79991231234");
    expect((await app.inject({ method: "GET", url: "/admin/segments/unknown", headers: { cookie } })).statusCode).toBe(400);
    const invalid = await app.inject({ method: "GET", url: "/admin/segments/regulars?limit=51", headers: { cookie } });
    expect(invalid.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(invalid.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
