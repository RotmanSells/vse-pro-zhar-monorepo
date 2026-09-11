import { describe, expect, it } from "vitest";

import type { AdminPromo, AdminPromoRedemptionsResponse, AdminPromosResponse } from "@vse-pro-zhar/contracts";

import { AdminPromosClientError, createAdminPromosClient } from "../src/admin-promos-client.js";

const promo: AdminPromo = {
  id: 1,
  code: "FIRE500",
  description: "Скидка",
  type: "fixed",
  value: 50_000,
  minimumOrderMinor: 200_000,
  currency: "RUB",
  activeFrom: "2026-09-01T00:00:00.000Z",
  activeUntil: null,
  globalUsageLimit: null,
  perCustomerUsageLimit: null,
  stackingPolicy: "none",
  status: "active",
  version: 1,
  usageCount: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
};
const response: AdminPromosResponse = { status: "confirmed", timezone: "Europe/Moscow", currency: "RUB", promos: [promo], pagination: { limit: 50, offset: 0, total: 1, hasNext: false }, customerCheckout: { status: "unavailable", reason: "owner_decision_required" } };
const audit: AdminPromoRedemptionsResponse = { status: "confirmed", promoId: 1, promoCode: "FIRE500", redemptions: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } };

describe("admin promos client", () => {
  it("uses protected CRUD paths and rejects invalid input before fetch", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = createAdminPromosClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async (input, init) => {
      requests.push({ url: input, method: init?.method ?? "GET" });
      return new Response(JSON.stringify(input.includes("/admin/promos?") ? response : input.includes("/redemptions?") ? audit : { promo }), { status: 200, headers: { "content-type": "application/json" } });
    } });
    await client.list({ limit: 50, offset: 0, search: "" });
    await client.create({ code: "FIRE500", type: "fixed", value: 50_000, minimumOrderMinor: 200_000, description: "", currency: "RUB", activeFrom: null, activeUntil: null, globalUsageLimit: null, perCustomerUsageLimit: null });
    await client.update(1, { description: "Новое" });
    await client.listRedemptions(1, { limit: 50, offset: 0 });
    await client.setActive(1, false);
    await client.archive(1);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET http://127.0.0.1:3000/admin/promos?limit=50&offset=0&search=",
      "POST http://127.0.0.1:3000/admin/promos",
      "PATCH http://127.0.0.1:3000/admin/promos/1",
      "GET http://127.0.0.1:3000/admin/promos/1/redemptions?limit=50&offset=0",
      "POST http://127.0.0.1:3000/admin/promos/1/deactivate",
      "POST http://127.0.0.1:3000/admin/promos/1/archive"
    ]);
    await expect(Promise.resolve().then(() => client.create({ code: "BAD CODE", type: "fixed", value: 100, minimumOrderMinor: 0, description: "", currency: "RUB", activeFrom: null, activeUntil: null, globalUsageLimit: null, perCustomerUsageLimit: null }))).rejects.toMatchObject({ kind: "validation" } satisfies Partial<AdminPromosClientError>);
  });
});
