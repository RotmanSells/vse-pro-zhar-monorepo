import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  CustomerProfileResponseSchema
} from "@vse-pro-zhar/contracts";
import type {
  CustomerProfileData,
  CustomerProfileRepository,
  CustomerRecord,
  CustomerRepository,
  CustomerSessionLookup,
  CustomerSessionRecord,
  CustomerUpsertInput,
  LoyaltyAccountAggregate,
  LoyaltyEarnCandidate,
  LoyaltyEarnResult,
  LoyaltyLedgerListResult,
  LoyaltyRepository,
  OrderItemRecord,
  OrderRecord
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";

const now = new Date("2026-09-04T10:00:00.000Z");

function createCustomerRepository(): CustomerRepository {
  const customer: CustomerRecord = {
    id: 1,
    phone: "+79991234567",
    name: "Анна",
    birthDate: null,
    createdAt: now,
    updatedAt: now
  };
  const sessions: CustomerSessionRecord[] = [];
  const lookup = (session: CustomerSessionRecord): CustomerSessionLookup | null => ({ customer, session });
  return {
    async upsertCustomerAndCreateSession(input: CustomerUpsertInput, session, createdAt) {
      customer.name = input.name;
      customer.birthDate = input.birthDate;
      const created: CustomerSessionRecord = {
        id: sessions.length + 1,
        customerId: customer.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt,
        updatedAt: createdAt
      };
      sessions.push(created);
      return { customer, session: created };
    },
    async findActiveSession(tokenHash, at) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null && candidate.expiresAt > at);
      if (session === undefined) return null;
      session.lastUsedAt = at;
      return lookup(session);
    },
    async revokeSession(tokenHash, at) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
      if (session !== undefined) session.revokedAt = at;
    },
    async cleanupExpiredSessions() { return undefined; }
  };
}

function order(): OrderRecord {
  return {
    id: 11,
    customerId: 1,
    pickupLocationId: "main-grill",
    pickupLocationName: "Основная точка",
    pickupLocationAddress: "ул. Бабушкина, 181",
    pickupLocationTimezone: "Europe/Moscow",
    pickupSlotId: "slot-1",
    pickupSlotLabel: "Сегодня, 18:00–18:30",
    pickupSlotStartsAt: new Date("2026-09-04T15:00:00.000Z"),
    pickupSlotEndsAt: new Date("2026-09-04T15:30:00.000Z"),
    status: "completed",
    totalMinor: 45_050,
    currency: "RUB",
    idempotencyKey: "order-11",
    payloadFingerprint: "a".repeat(64),
    createdAt: now,
    updatedAt: now
  };
}

function orderItem(): OrderItemRecord {
  return {
    id: 21,
    orderId: 11,
    productId: 3,
    productName: "Шашлык из свинины",
    unitPriceMinor: 45_050,
    quantity: 1,
    lineTotalMinor: 45_050
  };
}

function createProfileRepository(): CustomerProfileRepository {
  const currentOrder = order();
  const currentItem = orderItem();
  return {
    async getCustomerProfileData(customerId): Promise<CustomerProfileData> {
      if (customerId !== 1) return { orderCount: 0, recentOrders: [], itemSnapshots: [] };
      return {
        orderCount: 1,
        recentOrders: [{ order: currentOrder, items: [currentItem] }],
        itemSnapshots: [{ item: currentItem, orderCreatedAt: currentOrder.createdAt, orderId: currentOrder.id, customerId: currentOrder.customerId }]
      };
    }
  };
}

function createLoyaltyRepository(): LoyaltyRepository {
  const account = {
    id: 1,
    customerId: 1,
    xp: 450,
    coalBalance: 4,
    rankCode: "spark" as const,
    rankVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
  const aggregate: LoyaltyAccountAggregate = { account, ledgerXp: 450, ledgerCoal: 4, isConsistent: true };
  return {
    async getAccount(): Promise<LoyaltyAccountAggregate> { return aggregate; },
    async listCustomerLedger(): Promise<LoyaltyLedgerListResult> { return { entries: [], total: 0, account: aggregate }; },
    async listAdminLedger() { return { entries: [], total: 0, isConsistent: true }; },
    async claimNextEligibleOrder(): Promise<LoyaltyEarnCandidate | null> { return null; },
    async earnCompletedOrder(): Promise<LoyaltyEarnResult> { return { status: "ineligible", ledger: null, account: null, rankChanged: false }; }
  };
}

describe("customer profile API", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      customerRepository: createCustomerRepository(),
      profileRepository: createProfileRepository(),
      loyaltyRepository: createLoyaltyRepository()
    });
  });

  afterEach(async () => { await app.close(); });

  it("requires auth, returns only the own aggregate, and keeps settings truthful", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/profile" });
    expect(anonymous.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(anonymous.json()).error.code).toBe("AUTHENTICATION_ERROR");

    const identified = await app.inject({ method: "POST", url: "/auth/identify", payload: { phone: "+79991234567", name: "Анна" } });
    const cookie = String(identified.headers["set-cookie"]).split(";")[0];
    const response = await app.inject({ method: "GET", url: "/profile", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(CustomerProfileResponseSchema.parse(response.json())).toMatchObject({
      customer: { name: "Анна", phone: "+79991234567" },
      stats: { orderCount: 1, favoriteProduct: "Шашлык из свинины", nextMilestone: { remaining: 550, unit: "xp", source: "loyalty_rank" } },
      loyalty: { status: "confirmed", summary: { xp: 450, coalBalance: 4 } },
      recentOrders: [{ id: 11, items: [{ productName: "Шашлык из свинины", unitPriceMinor: 45_050 }] }],
      settings: {
        pushNotifications: { status: "unavailable" },
        emailSubscription: { status: "unavailable" },
        darkTheme: { status: "unavailable" }
      }
    });
    expect(JSON.stringify(response.json())).not.toContain("token");
    expect(JSON.stringify(response.json())).not.toContain("provider");
  });

  it("returns loyalty unavailable without inventing a balance when the loyalty repository is not configured", async () => {
    const unavailableApp = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      customerRepository: createCustomerRepository(),
      profileRepository: createProfileRepository()
    });
    const unavailableIdentified = await unavailableApp.inject({ method: "POST", url: "/auth/identify", payload: { phone: "+79991234567", name: "Анна" } });
    const unavailableCookie = String(unavailableIdentified.headers["set-cookie"]).split(";")[0];
    const response = await unavailableApp.inject({ method: "GET", url: "/profile", headers: { cookie: unavailableCookie } });
    expect(response.statusCode).toBe(200);
    expect(CustomerProfileResponseSchema.parse(response.json())).toMatchObject({ loyalty: { status: "unavailable", reason: "not_configured" }, stats: { nextMilestone: null } });
    await unavailableApp.close();
  });
});
