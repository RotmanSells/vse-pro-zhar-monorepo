import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdminCustomerRepository } from "@vse-pro-zhar/database";
import { AdminCustomersResponseSchema } from "@vse-pro-zhar/contracts";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

function repository(): AdminCustomerRepository {
  return {
    async list() {
      return {
        rows: [{ id: 1, name: "Анна", phone: "•••• 1234", orderCount: 2, spentMinor: 100_000, coalBalance: 10, xp: 100, rank: "spark", lastActivityAt: new Date("2026-09-01T10:00:00.000Z") }],
        total: 1
      };
    }
  };
}

describe("Admin customers API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, staffRepository: staff.repository, adminCustomerRepository: repository() });
  });

  afterEach(async () => { await app.close(); });

  it("requires staff auth and returns masked server-owned rows", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/customers" })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/customers?search=Анна", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(AdminCustomersResponseSchema.parse(response.json())).toMatchObject({ status: "confirmed", customers: [{ phoneMasked: "•••• 1234", spentMinor: 100_000 }] });
    expect(JSON.stringify(response.json())).not.toContain("+79991231234");
  });
});
