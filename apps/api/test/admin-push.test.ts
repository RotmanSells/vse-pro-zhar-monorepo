import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminPushSendResponseSchema,
  ApiErrorSchema
} from "@vse-pro-zhar/contracts";
import type {
  CustomerNotificationDeliveryRecord,
  CustomerPushRepository
} from "@vse-pro-zhar/database";
import { NotificationPushIdempotencyConflictError } from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createExpoPushProvider, type ExpoPushProvider } from "../src/notifications/expo-provider.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

const now = new Date("2026-09-11T10:00:00.000Z");

function pushRepository(options: { readonly devices?: boolean; readonly enabled?: boolean } = {}): CustomerPushRepository & {
  readonly deliveries: CustomerNotificationDeliveryRecord[];
  readonly disabledDeviceIds: number[];
} {
  const deliveries: CustomerNotificationDeliveryRecord[] = [];
  const disabledDeviceIds: number[] = [];
  let nextDeliveryId = 1;
  return {
    deliveries,
    disabledDeviceIds,
    async findCustomerIdByPhone(phone) { return phone === "+79991234567" ? 1 : null; },
    async isPushEnabled() { return options.enabled ?? true; },
    async listEnabledPushDevices() {
      return options.devices === false ? [] : [{ id: 10, provider: "expo", platform: "android", token: "ExponentPushToken[test-device]" }];
    },
    async prepareDelivery(input) {
      const existing = deliveries.find((delivery) => delivery.requestKey === input.requestKey && delivery.deviceId === input.deviceId);
      if (existing !== undefined) {
        if (existing.payloadFingerprint !== input.payloadFingerprint) throw new NotificationPushIdempotencyConflictError();
        return { delivery: existing, created: false };
      }
      const delivery: CustomerNotificationDeliveryRecord = {
        id: nextDeliveryId++, customerId: input.customerId, deviceId: input.deviceId, provider: "expo", requestKey: input.requestKey,
        payloadFingerprint: input.payloadFingerprint, providerTicketId: null, status: "pending", errorCode: null,
        createdAt: input.now, updatedAt: input.now
      };
      deliveries.push(delivery);
      return { delivery, created: true };
    },
    async updateDelivery(id, input) {
      const delivery = deliveries.find((candidate) => candidate.id === id);
      if (delivery === undefined) return null;
      Object.assign(delivery, input);
      return delivery;
    },
    async listDeliveries(requestKey) { return deliveries.filter((delivery) => delivery.requestKey === requestKey); },
    async disableDevice(deviceId) { disabledDeviceIds.push(deviceId); }
  };
}

function provider(send: ExpoPushProvider["send"]): ExpoPushProvider {
  return { send };
}

describe("Admin real Push delivery", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      staffRepository: staff.repository,
      pushRepository: pushRepository(),
      pushProvider: provider(async () => ({ status: "ok", id: "ticket-1" }))
    });
  });

  afterEach(async () => { await app.close(); });

  it("requires staff auth, sends once and replays idempotently", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/notifications/push", headers: { "idempotency-key": "push-1" }, payload: { phone: "+79991234567", title: "Тест", body: "Проверка Push" } })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const request = { method: "POST" as const, url: "/admin/notifications/push", headers: { cookie, "idempotency-key": "push-1" }, payload: { phone: "8 (999) 123-45-67", title: "Тест", body: "Проверка Push" } };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(AdminPushSendResponseSchema.parse(first.json())).toMatchObject({ replayed: false, deliveries: [{ status: "accepted", providerTicketId: "ticket-1" }] });
    const second = await app.inject(request);
    expect(second.statusCode).toBe(202);
    expect(AdminPushSendResponseSchema.parse(second.json()).replayed).toBe(true);
    const conflict = await app.inject({ ...request, payload: { ...request.payload, body: "Другой текст" } });
    expect(conflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(conflict.json()).error.code).toBe("NOTIFICATION_PUSH_CONFLICT");
  });

  it("does not call provider without an enabled device or preference", async () => {
    const staff = await createMemoryStaffRepository();
    const send = vi.fn(async () => ({ status: "ok" as const, id: "ticket-noop" }));
    const repository = pushRepository({ devices: false });
    const noDeviceApp = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, staffRepository: staff.repository, pushRepository: repository, pushProvider: provider(send) });
    const cookie = await staffCookie(noDeviceApp);
    const response = await noDeviceApp.inject({ method: "POST", url: "/admin/notifications/push", headers: { cookie, "idempotency-key": "push-no-device" }, payload: { phone: "+79991234567", title: "Тест", body: "Проверка" } });
    expect(response.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe("NOTIFICATION_PUSH_NO_DEVICE");
    expect(send).not.toHaveBeenCalled();
    await noDeviceApp.close();

    const disabledApp = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, staffRepository: staff.repository, pushRepository: pushRepository({ enabled: false }), pushProvider: provider(send) });
    const disabledCookie = await staffCookie(disabledApp);
    const disabled = await disabledApp.inject({ method: "POST", url: "/admin/notifications/push", headers: { cookie: disabledCookie, "idempotency-key": "push-disabled" }, payload: { phone: "+79991234567", title: "Тест", body: "Проверка" } });
    expect(disabled.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(disabled.json()).error.code).toBe("NOTIFICATION_PUSH_DISABLED");
    expect(send).not.toHaveBeenCalled();
    await disabledApp.close();
  });

  it("maps DeviceNotRegistered and disables the device", async () => {
    const repository = pushRepository();
    const staff = await createMemoryStaffRepository();
    const failingApp = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      staffRepository: staff.repository,
      pushRepository: repository,
      pushProvider: provider(async () => ({ status: "error", errorCode: "DeviceNotRegistered" }))
    });
    const cookie = await staffCookie(failingApp);
    const response = await failingApp.inject({ method: "POST", url: "/admin/notifications/push", headers: { cookie, "idempotency-key": "push-dead-device" }, payload: { phone: "+79991234567", title: "Тест", body: "Проверка" } });
    expect(response.statusCode).toBe(202);
    expect(AdminPushSendResponseSchema.parse(response.json()).deliveries[0]).toMatchObject({ status: "failed", errorCode: "DeviceNotRegistered" });
    expect(repository.disabledDeviceIds).toEqual([10]);
    await failingApp.close();
  });
});

describe("Expo Push provider", () => {
  it("sends a valid notification and parses the ticket", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ to: "ExponentPushToken[test]", title: "Тест", body: "Сообщение" });
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket-42" }] }), { status: 200 });
    });
    await expect(createExpoPushProvider({ endpoint: "https://push.test/send", fetchImpl }).send({ token: "ExponentPushToken[test]", title: "Тест", body: "Сообщение" })).resolves.toEqual({ status: "ok", id: "ticket-42" });
  });

  it("turns provider timeout into reconciliation-required", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await expect(createExpoPushProvider({ fetchImpl, timeoutMs: 1 }).send({ token: "ExponentPushToken[test]", title: "Тест", body: "Сообщение" })).rejects.toMatchObject({ kind: "reconciliation_required", errorCode: "provider_timeout" });
  });
});
