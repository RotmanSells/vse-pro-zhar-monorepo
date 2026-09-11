import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AdminOrderDetailSchema,
  AdminOrdersListResponseSchema,
  ApiErrorSchema
} from "@vse-pro-zhar/contracts";
import type {
  AdminOrderRepository,
  AdminOrderResult,
  AdminRecoveryResult,
  IikoOrderDispatchRecord,
  OrderItemRecord,
  OrderRecord,
  OrderStatusHistoryRecord,
  PaymentRecord
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie, type MemoryStaffState } from "./staff-fixtures.js";

const now = new Date("2026-09-01T10:00:00.000Z");

function createAggregate(): AdminOrderResult {
  const order: OrderRecord = {
    id: 42,
    customerId: 7,
    pickupLocationId: "main-grill",
    pickupLocationName: "Основная точка",
    pickupLocationAddress: "ул. Жара, 1",
    pickupLocationTimezone: "Europe/Moscow",
    pickupSlotId: "slot-42",
    pickupSlotLabel: "Сегодня, 18:00–18:30",
    pickupSlotStartsAt: new Date("2026-09-01T15:00:00.000Z"),
    pickupSlotEndsAt: new Date("2026-09-01T15:30:00.000Z"),
    status: "fulfillment_problem",
    totalMinor: 100_000,
    currency: "RUB",
    idempotencyKey: "order-42",
    payloadFingerprint: "a".repeat(64),
    createdAt: now,
    updatedAt: now
  };
  const item: OrderItemRecord = { id: 1, orderId: 42, productId: 9, productName: "Шашлык", unitPriceMinor: 100_000, quantity: 1, lineTotalMinor: 100_000 };
  const payment: PaymentRecord = { id: 3, orderId: 42, customerId: 7, provider: "yookassa", providerPaymentId: "yk-42", amountMinor: 100_000, currency: "RUB", status: "succeeded", providerStatus: "succeeded", confirmationType: null, confirmationUrl: null, idempotencyKey: "payment-42", payloadFingerprint: "b".repeat(64), createdAt: now, updatedAt: now };
  const dispatch: IikoOrderDispatchRecord = { id: 4, orderId: 42, correlationId: "corr-42", providerOrderId: null, commandId: null, status: "failed", attemptCount: 3, nextAttemptAt: now, lastAttemptAt: now, lastErrorCode: "retry_exhausted", createdAt: now, updatedAt: now };
  const history: OrderStatusHistoryRecord[] = [
    { id: 1, orderId: 42, status: "pending_payment", createdAt: now },
    { id: 2, orderId: 42, status: "payment_confirmed", createdAt: new Date(now.getTime() + 1_000) },
    { id: 3, orderId: 42, status: "fulfillment_problem", createdAt: new Date(now.getTime() + 2_000) }
  ];
  return { order, customer: { id: 7, phone: "+79991234567", name: "Анна" }, items: [item], payment, dispatch, history };
}

function createMemoryAdminOrdersRepository(): { readonly repository: AdminOrderRepository; readonly aggregate: AdminOrderResult; readonly recoveryCalls: number } {
  let aggregate = createAggregate();
  let recoveryCalls = 0;
  const repository: AdminOrderRepository = {
    async list(filters) {
      const matchesStatus = filters.status === undefined || aggregate.order.status === filters.status;
      const matchesPayment = filters.paymentStatus === undefined || filters.paymentStatus === "succeeded";
      const matchesSearch = filters.search === undefined || String(aggregate.order.id).includes(filters.search) || aggregate.customer.phone.includes(filters.search);
      return { orders: matchesStatus && matchesPayment && matchesSearch ? [aggregate] : [], total: matchesStatus && matchesPayment && matchesSearch ? 1 : 0 };
    },
    async findById(orderId) { return orderId === aggregate.order.id ? aggregate : null; },
    async retryFulfillment({ orderId }) {
      if (orderId !== aggregate.order.id) throw new Error("missing");
      if (aggregate.dispatch?.status === "failed") {
        recoveryCalls += 1;
        aggregate = { ...aggregate, dispatch: { ...aggregate.dispatch, status: "pending", lastErrorCode: null } };
      }
      return { order: aggregate, mode: recoveryCalls === 1 ? "create" : "already_in_progress" } as AdminRecoveryResult;
    }
  };
  return { repository, aggregate, get recoveryCalls() { return recoveryCalls; } };
}

describe("Admin auth and orders API", () => {
  let app: FastifyInstance;
  let staff: MemoryStaffState;
  let orders: ReturnType<typeof createMemoryAdminOrdersRepository>;
  let currentNow = now;

  beforeEach(async () => {
    currentNow = now;
    staff = await createMemoryStaffRepository();
    orders = createMemoryAdminOrdersRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => currentNow, staffRepository: staff.repository, adminOrderRepository: orders.repository });
  });

  afterEach(async () => { await app.close(); });

  it("keeps staff auth separate, restores session and logs out", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/admin/orders" });
    expect(anonymous.statusCode).toBe(401);
    const customerLike = await app.inject({ method: "GET", url: "/admin/orders", headers: { cookie: "vse-pro-zhar-session=customer-token" } });
    expect(customerLike.statusCode).toBe(401);
    const wrong = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { login: "admin", password: "wrong-password" } });
    expect(wrong.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(wrong.json()).error.message).toBe("Сессия недействительна или истекла");
    const cookie = await staffCookie(app);
    const me = await app.inject({ method: "GET", url: "/admin/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().staff).toMatchObject({ login: "admin", displayName: "Главный администратор" });
    expect(me.json().staff).not.toHaveProperty("role");
    expect(String(me.json())).not.toContain("passwordHash");
    const loggedOut = await app.inject({ method: "POST", url: "/admin/auth/logout", headers: { cookie } });
    expect(loggedOut.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/admin/auth/me", headers: { cookie } })).statusCode).toBe(401);
    expect(staff.audits.map((audit) => audit.action)).toEqual(["staff_login", "staff_logout"]);
  });

  it("lists snapshots, exposes safe fulfillment state and makes retry idempotent", async () => {
    const cookie = await staffCookie(app);
    const list = await app.inject({ method: "GET", url: "/admin/orders?status=fulfillment_problem&search=42", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(AdminOrdersListResponseSchema.parse(list.json())).toMatchObject({ orders: [{ id: 42, fulfillmentStatus: "failed", fulfillmentErrorCode: "retry_exhausted", customer: { phoneMasked: "•••• 4567" } }], pagination: { total: 1 } });
    const detail = await app.inject({ method: "GET", url: "/admin/orders/42", headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(AdminOrderDetailSchema.parse(detail.json())).toMatchObject({ customer: { phone: "+79991234567" }, items: [{ productName: "Шашлык", unitPriceMinor: 100_000 }], fulfillment: { correlationId: "corr-42", providerOrderId: null }, history: [{ status: "pending_payment" }, { status: "payment_confirmed" }, { status: "fulfillment_problem" }] });
    expect(JSON.stringify(detail.json())).not.toContain("providerPayload");

    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/admin/orders/42/fulfillment/retry", headers: { cookie } }),
      app.inject({ method: "POST", url: "/admin/orders/42/fulfillment/retry", headers: { cookie } })
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(orders.recoveryCalls).toBe(1);
    expect(staff.audits.filter((audit) => audit.action === "order_fulfillment_retry")).toHaveLength(0);
    expect(first.json().order.fulfillment.correlationId).toBe("corr-42");
  });

  it("gives the administrator access to both orders and catalog", async () => {
    const cookie = await staffCookie(app);
    const list = await app.inject({ method: "GET", url: "/admin/orders", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const catalog = await app.inject({ method: "POST", url: "/admin/products", headers: { cookie }, payload: {} });
    expect(catalog.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(catalog.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects inactive and expired sessions and rate-limits login attempts", async () => {
    staff.users[0]!.isActive = false;
    const inactive = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { login: "admin", password: "correct-horse-battery" } });
    expect(inactive.statusCode).toBe(401);
    const attempts = await Promise.all(Array.from({ length: 9 }, () => app.inject({ method: "POST", url: "/admin/auth/login", payload: { login: "missing", password: "correct-horse-battery" } })));
    expect(attempts.every((response) => response.statusCode === 401)).toBe(true);
    expect((await app.inject({ method: "POST", url: "/admin/auth/login", payload: { login: "missing", password: "correct-horse-battery" } })).statusCode).toBe(429);

    await app.close();
    staff = await createMemoryStaffRepository();
    currentNow = now;
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, now: () => currentNow, staffRepository: staff.repository, adminOrderRepository: orders.repository });
    staff.users[0]!.isActive = true;
    const cookie = await staffCookie(app);
    currentNow = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
    expect((await app.inject({ method: "GET", url: "/admin/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });
});
