import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AdminLoyaltyLedgerResponseSchema,
  ApiErrorSchema,
  LoyaltyLedgerResponseSchema,
  LoyaltySummaryResponseSchema
} from "@vse-pro-zhar/contracts";
import type {
  AdminLoyaltyLedgerListResult,
  CustomerRecord,
  CustomerRepository,
  CustomerSessionLookup,
  CustomerSessionRecord,
  CustomerUpsertInput,
  LoyaltyAccountAggregate,
  LoyaltyEarnCandidate,
  LoyaltyEarnResult,
  LoyaltyEarnTransactionInput,
  LoyaltyLedgerListResult,
  LoyaltyRepository,
  LoyaltyLedgerRecord,
  LoyaltyAccountRecord
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

const now = new Date("2026-09-04T10:00:00.000Z");

function createCustomerRepository(): CustomerRepository {
  const customer: CustomerRecord = { id: 1, phone: "+79991234567", name: "Анна", birthDate: null, createdAt: now, updatedAt: now };
  const sessions: CustomerSessionRecord[] = [];
  const lookup = (session: CustomerSessionRecord): CustomerSessionLookup | null => ({ customer, session });
  return {
    async upsertCustomerAndCreateSession(input: CustomerUpsertInput, session, createdAt) {
      customer.name = input.name;
      const created: CustomerSessionRecord = { id: sessions.length + 1, customerId: customer.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt, revokedAt: null, lastUsedAt: null, createdAt, updatedAt: createdAt };
      sessions.push(created);
      return { customer, session: created };
    },
    async findActiveSession(tokenHash, at) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null && candidate.expiresAt > at);
      return session === undefined ? null : lookup(session);
    },
    async revokeSession(tokenHash, at) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
      if (session !== undefined) session.revokedAt = at;
    },
    async cleanupExpiredSessions() { return undefined; }
  };
}

function createLoyaltyRepository(): LoyaltyRepository {
  const account: LoyaltyAccountRecord = { id: 1, customerId: 1, xp: 450, coalBalance: 4, rankCode: "spark", rankVersion: 1, version: 1, createdAt: now, updatedAt: now };
  const entry: LoyaltyLedgerRecord = { id: 1, loyaltyAccountId: 1, customerId: 1, entryType: "earned", sourceType: "completed_order", sourceId: "7", sourceOrderId: 7, ruleVersion: 1, idempotencyKey: "loyalty:completed-order:7:v1", xpDelta: 450, coalDelta: 4, xpBalance: 450, coalBalance: 4, sourceOrderTotalMinor: 45_050, sourceOrderCurrency: "RUB", reason: "Завершённый оплаченный заказ", actorType: "system", actorId: null, createdAt: now };
  const aggregate: LoyaltyAccountAggregate = { account, ledgerXp: 450, ledgerCoal: 4, isConsistent: true };
  return {
    async getAccount() { return aggregate; },
    async listCustomerLedger(): Promise<LoyaltyLedgerListResult> { return { entries: [entry], total: 1, account: aggregate }; },
    async listAdminLedger(): Promise<AdminLoyaltyLedgerListResult> { return { entries: [{ entry, customer: { id: 1, name: "Анна", phone: "+79991234567" } }], total: 1, isConsistent: true }; },
    async claimNextEligibleOrder(): Promise<LoyaltyEarnCandidate | null> { return null; },
    async earnCompletedOrder(input: LoyaltyEarnTransactionInput): Promise<LoyaltyEarnResult> { void input; return { status: "already_earned", ledger: entry, account, rankChanged: false }; }
  };
}

describe("loyalty API", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => now, customerRepository: createCustomerRepository(), staffRepository: staff.repository, loyaltyRepository: createLoyaltyRepository() });
  });
  afterEach(async () => { await app.close(); });

  it("requires Customer auth and returns only confirmed server-owned state", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/loyalty" });
    expect(anonymous.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(anonymous.json()).error.code).toBe("AUTHENTICATION_ERROR");
    const identified = await app.inject({ method: "POST", url: "/auth/identify", payload: { phone: "+79991234567", name: "Анна" } });
    const cookie = String(identified.headers["set-cookie"]).split(";")[0];
    const summary = await app.inject({ method: "GET", url: "/loyalty", headers: { cookie } });
    expect(summary.statusCode).toBe(200);
    expect(LoyaltySummaryResponseSchema.parse(summary.json())).toMatchObject({
      status: "confirmed",
      summary: {
        xp: 450,
        coalBalance: 4,
        rank: { code: "spark" },
        nextRank: { code: "heat", thresholdXp: 1_000 },
        xpIntoCurrentRank: 450,
        xpToNextRank: 550,
        progressPercent: 45,
        isMaxRank: false
      }
    });
    const ledger = await app.inject({ method: "GET", url: "/loyalty/ledger?limit=10&offset=0", headers: { cookie } });
    expect(ledger.statusCode).toBe(200);
    expect(LoyaltyLedgerResponseSchema.parse(ledger.json())).toMatchObject({ status: "confirmed", entries: [{ sourceOrderId: 7, xpDelta: 450, coalDelta: 4 }] });
  });

  it("protects the Admin read surface and never exposes the full phone", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/admin/loyalty/ledger" });
    expect(anonymous.statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/loyalty/ledger", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(AdminLoyaltyLedgerResponseSchema.parse(response.json())).toMatchObject({ status: "confirmed", entries: [{ customer: { phoneMasked: "•••• 4567" }, sourceOrderId: 7 }], rule: { xpPerRuble: 1, rublesPerCoal: 100, redemptionEnabled: true } });
    expect(JSON.stringify(response.json())).not.toContain("+79991234567");
  });
});
