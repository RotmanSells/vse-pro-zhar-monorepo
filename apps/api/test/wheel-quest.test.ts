import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiErrorSchema } from "@vse-pro-zhar/contracts";
import type { CustomerRecord, CustomerRepository, CustomerSessionLookup, CustomerSessionRecord, CustomerUpsertInput, QuestDefinitionRecord, WheelPrizeRecord, WheelQuestRepository, WheelSettingsRecord } from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

describe("M14 loyalty HTTP boundaries", () => {
  let app: FastifyInstance;
  const now = new Date("2026-09-06T10:00:00.000Z");

  function customerRepository(): CustomerRepository {
    const customer: CustomerRecord = { id: 1, phone: "+79991234567", name: "Анна", birthDate: null, createdAt: now, updatedAt: now };
    const sessions: CustomerSessionRecord[] = [];
    const lookup = (session: CustomerSessionRecord): CustomerSessionLookup | null => ({ customer, session });
    return {
      async upsertCustomerAndCreateSession(input: CustomerUpsertInput, session, createdAt) { customer.name = input.name; const record: CustomerSessionRecord = { id: sessions.length + 1, customerId: customer.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt, revokedAt: null, lastUsedAt: null, createdAt, updatedAt: createdAt }; sessions.push(record); return { customer, session: record }; },
      async findActiveSession(tokenHash, at) { const session = sessions.find((candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null && candidate.expiresAt > at); return session === undefined ? null : lookup(session); },
      async revokeSession() { return undefined; },
      async cleanupExpiredSessions() { return undefined; }
    };
  }

  beforeEach(async () => {
    const staff = await createMemoryStaffRepository();
    const repository = { getWheelState: async () => null, spin: async () => ({ status: "unavailable" as const }) } as unknown as WheelQuestRepository;
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => now, customerRepository: customerRepository(), staffRepository: staff.repository, wheelQuestRepository: repository });
  });
  afterEach(async () => { await app.close(); });

  it("requires authentication and never accepts client reward or progress fields", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/loyalty/wheel" });
    expect(anonymous.statusCode).toBe(401);
    const identified = await app.inject({ method: "POST", url: "/auth/identify", payload: { phone: "+79991234567", name: "Анна" } });
    const cookie = String(identified.headers["set-cookie"]).split(";")[0];
    const wheel = await app.inject({ method: "GET", url: "/loyalty/wheel", headers: { cookie } });
    expect(wheel.statusCode).toBe(200);
    expect(wheel.json()).toEqual({ status: "unavailable", reason: "not_configured" });
    const malformed = await app.inject({ method: "POST", url: "/loyalty/wheel/spin", headers: { cookie, "idempotency-key": "m14-spin" }, payload: { orderId: 1, rewardValue: 999 } });
    expect(malformed.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(malformed.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("protects quest mutations, requires idempotency, and checks definition versions", async () => {
    const staff = await createMemoryStaffRepository();
    let quest: QuestDefinitionRecord = { id: 1, code: "first_order", title: "Первый жар", description: "", goal: 1, unit: "order", rewardType: "xp", rewardValue: 100, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1, createdAt: now, updatedAt: now };
    const seenKeys = new Set<string>();
    const repository = {
      getAdminQuests: async () => [quest],
      createQuest: async (input: { readonly code: string; readonly title: string; readonly description: string; readonly goal: number; readonly unit: "order" | "minor_units"; readonly rewardType: "xp" | "coal"; readonly rewardValue: number; readonly isVisible: boolean; readonly activeFrom: Date | null; readonly activeUntil: Date | null; readonly sortOrder: number }) => {
        const created = !seenKeys.has(input.code);
        seenKeys.add(input.code);
        if (created) quest = { ...quest, id: 2, code: input.code, title: input.title, description: input.description, goal: input.goal, unit: input.unit, rewardType: input.rewardType, rewardValue: input.rewardValue, isVisible: input.isVisible, activeFrom: input.activeFrom, activeUntil: input.activeUntil, sortOrder: input.sortOrder, version: 1 };
        return { definition: quest, created };
      },
      updateQuest: async (_id: number, input: { readonly expectedVersion: number; readonly isVisible?: boolean }) => { quest = { ...quest, isVisible: input.isVisible ?? quest.isVisible, version: quest.version + 1, updatedAt: now }; return quest; }
    } as unknown as WheelQuestRepository;
    await app.close();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => now, customerRepository: customerRepository(), staffRepository: staff.repository, wheelQuestRepository: repository });

    expect((await app.inject({ method: "POST", url: "/admin/loyalty/quests", payload: { code: "spring_fire", title: "Весенний жар", goal: 2, unit: "order", rewardType: "xp", rewardValue: 50 } })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const missingKey = await app.inject({ method: "POST", url: "/admin/loyalty/quests", headers: { cookie }, payload: { code: "spring_fire", title: "Весенний жар", goal: 2, unit: "order", rewardType: "xp", rewardValue: 50 } });
    expect(missingKey.statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/admin/loyalty/quests", headers: { cookie, "idempotency-key": "quest-create-1" }, payload: { code: "spring_fire", title: "Весенний жар", goal: 2, unit: "order", rewardType: "xp", rewardValue: 50 } });
    expect(created.statusCode).toBe(201);
    const repeated = await app.inject({ method: "POST", url: "/admin/loyalty/quests", headers: { cookie, "idempotency-key": "quest-create-1" }, payload: { code: "spring_fire", title: "Весенний жар", goal: 2, unit: "order", rewardType: "xp", rewardValue: 50 } });
    expect(repeated.statusCode).toBe(200);
    const invalidUpdate = await app.inject({ method: "PATCH", url: "/admin/loyalty/quests/2", headers: { cookie }, payload: { isVisible: false } });
    expect(invalidUpdate.statusCode).toBe(400);
  });

  it("protects wheel settings with staff auth, version and idempotency boundaries", async () => {
    const staff = await createMemoryStaffRepository();
    const settings: WheelSettingsRecord = { id: 1, enabled: true, eligibility: "completed_paid_order", minOrderAmountMinor: 150_000, currency: "RUB", cooldownSeconds: 86_400, maxSpins: 1, limitPeriodSeconds: 86_400, activeFrom: now, activeUntil: null, version: 1, createdAt: now, updatedAt: now };
    const prize = { id: 1, code: "no_prize", name: "Искра рядом", description: "", prizeType: "no_prize", value: 0, weight: 100, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1, createdAt: now, updatedAt: now } as WheelPrizeRecord;
    const repository = {
      getAdminWheel: async () => ({ settings, prizes: [prize] }),
      updateWheelSettings: async (input: { readonly expectedVersion: number; readonly enabled?: boolean; readonly minOrderAmountMinor?: number; readonly cooldownSeconds?: number; readonly maxSpins?: number; readonly limitPeriodSeconds?: number; readonly activeFrom?: Date | null; readonly activeUntil?: Date | null }) => {
        Object.assign(settings, { enabled: input.enabled ?? settings.enabled, minOrderAmountMinor: input.minOrderAmountMinor ?? settings.minOrderAmountMinor, cooldownSeconds: input.cooldownSeconds ?? settings.cooldownSeconds, maxSpins: input.maxSpins ?? settings.maxSpins, limitPeriodSeconds: input.limitPeriodSeconds ?? settings.limitPeriodSeconds, activeFrom: input.activeFrom === undefined ? settings.activeFrom : input.activeFrom, activeUntil: input.activeUntil === undefined ? settings.activeUntil : input.activeUntil, version: settings.version + 1, updatedAt: now });
        return { settings, prizes: [prize] };
      }
    } as unknown as WheelQuestRepository;
    await app.close();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => now, customerRepository: customerRepository(), staffRepository: staff.repository, wheelQuestRepository: repository });

    expect((await app.inject({ method: "GET", url: "/admin/loyalty/wheel" })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    expect((await app.inject({ method: "PATCH", url: "/admin/loyalty/wheel/settings", headers: { cookie }, payload: { expectedVersion: 1, maxSpins: 2 } })).statusCode).toBe(400);
    const invalid = await app.inject({ method: "PATCH", url: "/admin/loyalty/wheel/settings", headers: { cookie, "idempotency-key": "wheel-settings-1" }, payload: { expectedVersion: 1, currency: "USD" } });
    expect(invalid.statusCode).toBe(400);
    const updated = await app.inject({ method: "PATCH", url: "/admin/loyalty/wheel/settings", headers: { cookie, "idempotency-key": "wheel-settings-1" }, payload: { expectedVersion: 1, minOrderAmountMinor: 200_000, cooldownSeconds: 3_600, maxSpins: 2, limitPeriodSeconds: 172_800, activeFrom: now.toISOString(), activeUntil: null } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings).toMatchObject({ minOrderAmountMinor: 200_000, cooldownSeconds: 3_600, maxSpins: 2, limitPeriodSeconds: 172_800, version: 2 });
  });

  it("updates Wheel prize value/type only through staff, version and idempotency boundaries", async () => {
    const staff = await createMemoryStaffRepository();
    const settings: WheelSettingsRecord = { id: 1, enabled: true, eligibility: "completed_paid_order", minOrderAmountMinor: 150_000, currency: "RUB", cooldownSeconds: 86_400, maxSpins: 1, limitPeriodSeconds: 86_400, activeFrom: null, activeUntil: null, version: 1, createdAt: now, updatedAt: now };
    let prize: WheelPrizeRecord = { id: 1, code: "no_prize", name: "Искра рядом", description: "", prizeType: "no_prize", value: 0, weight: 50, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1, createdAt: now, updatedAt: now };
    const repository = {
      getAdminWheel: async () => ({ settings, prizes: [prize] }),
      updateWheelPrize: async (_id: number, input: { readonly expectedVersion: number; readonly type?: "no_prize" | "coal" | "xp"; readonly value?: number; readonly weight?: number }) => {
        if (input.expectedVersion !== prize.version) throw new Error("stale");
        prize = { ...prize, prizeType: input.type ?? prize.prizeType, value: input.value ?? prize.value, weight: input.weight ?? prize.weight, version: prize.version + 1, updatedAt: now };
        return prize;
      }
    } as unknown as WheelQuestRepository;
    await app.close();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => now, customerRepository: customerRepository(), staffRepository: staff.repository, wheelQuestRepository: repository });

    expect((await app.inject({ method: "PATCH", url: "/admin/loyalty/wheel/prizes/1", payload: { expectedVersion: 1, type: "xp", value: 111 } })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    expect((await app.inject({ method: "PATCH", url: "/admin/loyalty/wheel/prizes/1", headers: { cookie }, payload: { expectedVersion: 1, type: "xp", value: 111 } })).statusCode).toBe(400);
    const updated = await app.inject({ method: "PATCH", url: "/admin/loyalty/wheel/prizes/1", headers: { cookie, "idempotency-key": "wheel-prize-1" }, payload: { expectedVersion: 1, type: "xp", value: 111, weight: 20 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().prizes[0]).toMatchObject({ type: "xp", value: 111, weight: 20, version: 2 });
  });
});
