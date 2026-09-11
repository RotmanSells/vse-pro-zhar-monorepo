import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiErrorSchema, CustomerNotificationPreferencesResponseSchema, CustomerIdentifyResponseSchema } from "@vse-pro-zhar/contracts";
import type { CustomerNotificationDeviceRecord, CustomerNotificationPreferencesRecord, CustomerNotificationRepository, CustomerRecord, CustomerRepository, CustomerSessionLookup, CustomerSessionRecord, CustomerUpsertInput } from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";

function customerRepository(): CustomerRepository {
  const customer: CustomerRecord = { id: 1, phone: "+79991234567", name: "Анна", birthDate: null, createdAt: new Date("2026-09-01T10:00:00.000Z"), updatedAt: new Date("2026-09-01T10:00:00.000Z") };
  const sessions: CustomerSessionRecord[] = [];
  let nextSessionId = 1;
  return {
    async upsertCustomerAndCreateSession(input: CustomerUpsertInput, session, now): Promise<CustomerSessionLookup> {
      customer.name = input.name; customer.birthDate = input.birthDate; customer.updatedAt = now;
      const created: CustomerSessionRecord = { id: nextSessionId++, customerId: customer.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt, revokedAt: null, lastUsedAt: null, createdAt: now, updatedAt: now };
      sessions.push(created);
      return { customer, session: created };
    },
    async findActiveSession(tokenHash, now) { const session = sessions.find((candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null && candidate.expiresAt > now); if (session === undefined) return null; return { customer, session }; },
    async revokeSession(tokenHash, now) { const session = sessions.find((candidate) => candidate.tokenHash === tokenHash); if (session !== undefined) session.revokedAt = now; },
    async cleanupExpiredSessions() {}
  };
}

function notificationRepository(): CustomerNotificationRepository & { readonly devices: CustomerNotificationDeviceRecord[] } {
  const devices: CustomerNotificationDeviceRecord[] = [];
  const keys = new Map<string, string>();
  let nextId = 1;
  let preferences: CustomerNotificationPreferencesRecord = { id: 1, customerId: 1, pushEnabled: true, smsEnabled: false, updatedAt: new Date("2026-09-01T10:00:00.000Z") };
  return {
    devices,
    async registerDevice(input) {
      const previous = keys.get(input.idempotencyKey);
      if (previous !== undefined && previous !== input.payloadFingerprint) throw new Error("unexpected conflict in memory test");
      if (previous !== undefined) return { device: devices[0] as CustomerNotificationDeviceRecord, created: false };
      keys.set(input.idempotencyKey, input.payloadFingerprint);
      const device: CustomerNotificationDeviceRecord = { id: nextId++, customerId: input.customerId, provider: input.provider, platform: input.platform, token: input.token, enabled: true, idempotencyKey: input.idempotencyKey, payloadFingerprint: input.payloadFingerprint, lastSeenAt: input.now, createdAt: input.now, updatedAt: input.now };
      devices.push(device);
      return { device, created: true };
    },
    async listDevices() { return devices.filter((device) => device.enabled); },
    async revokeDevice(_customerId, id, now) { const device = devices.find((candidate) => candidate.id === id); if (device === undefined) return false; device.enabled = false; device.updatedAt = now; return true; },
    async getPreferences() { return preferences; },
    async updatePreferences(input) { preferences = { ...preferences, pushEnabled: input.pushEnabled ?? preferences.pushEnabled, smsEnabled: input.smsEnabled ?? preferences.smsEnabled, updatedAt: input.now }; return preferences; }
  };
}

describe("customer notification API", () => {
  let app: FastifyInstance;
  let repository: ReturnType<typeof notificationRepository>;
  const now = new Date("2026-09-01T10:00:00.000Z");

  beforeEach(async () => {
    repository = notificationRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => now, customerRepository: customerRepository(), notificationRepository: repository });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it("registers an authenticated native device idempotently and supports preferences", async () => {
    const identified = await app.inject({ method: "POST", url: "/auth/identify", headers: { "x-session-transport": "bearer" }, payload: { phone: "+79991234567", name: "Анна" } });
    const token = CustomerIdentifyResponseSchema.parse(identified.json()).session.token as string;
    const headers = { authorization: `Bearer ${token}` };
    const body = { idempotencyKey: "push-test-1", provider: "expo", platform: "ios", token: "ExponentPushToken[test-device]" } as const;
    expect((await app.inject({ method: "POST", url: "/notifications/devices", headers, payload: body })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/notifications/devices", headers, payload: body })).statusCode).toBe(200);
    expect(repository.devices).toHaveLength(1);
    const listed = await app.inject({ method: "GET", url: "/notifications/devices", headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().devices).toHaveLength(1);
    const updated = await app.inject({ method: "PATCH", url: "/notifications/preferences", headers, payload: { pushEnabled: false } });
    expect(updated.statusCode).toBe(200);
    expect(CustomerNotificationPreferencesResponseSchema.parse(updated.json()).preferences.pushEnabled).toBe(false);
    expect((await app.inject({ method: "DELETE", url: "/notifications/devices/1", headers })).json()).toMatchObject({ status: "confirmed", revoked: true });
    expect((await app.inject({ method: "GET", url: "/notifications/devices", headers })).json().devices).toHaveLength(0);
  });

  it("requires a customer session", async () => {
    const response = await app.inject({ method: "GET", url: "/notifications/preferences" });
    expect(response.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe("AUTHENTICATION_ERROR");
  });
});
