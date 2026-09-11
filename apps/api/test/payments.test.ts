import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiErrorSchema,
  PaymentStateResponseSchema
} from "@vse-pro-zhar/contracts";
import type {
  CatalogRepository,
  CatalogSnapshot,
  CustomerRecord,
  CustomerRepository,
  CustomerSessionLookup,
  CustomerSessionRecord,
  CustomerUpsertInput,
  CreatePaymentInput,
  OrderAggregate,
  OrderRecord,
  OrderRepository,
  PaymentAggregate,
  PaymentEventResult,
  PaymentProviderEventInput,
  PaymentRecord,
  PaymentRepository
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import type { PaymentProvider } from "../src/payments/provider.js";
import type { OperationalAvailabilityProvider } from "../src/checkout/availability.js";
import { loadConfig } from "../src/config/env.js";

const now = new Date("2026-09-01T07:00:00.000Z");

function createCustomerRepository(): CustomerRepository {
  const customers: CustomerRecord[] = [];
  const sessions: CustomerSessionRecord[] = [];
  let nextCustomerId = 1;
  let nextSessionId = 1;

  const lookup = (session: CustomerSessionRecord): CustomerSessionLookup | null => {
    const customer = customers.find((candidate) => candidate.id === session.customerId);
    return customer === undefined ? null : { customer, session };
  };

  return {
    async upsertCustomerAndCreateSession(input: CustomerUpsertInput, session, createdAt) {
      const current = customers.find((candidate) => candidate.phone === input.phone);
      const customer = current ?? {
        id: nextCustomerId++,
        phone: input.phone,
        name: input.name,
        birthDate: input.birthDate,
        createdAt,
        updatedAt: createdAt
      };
      if (current === undefined) customers.push(customer);
      else Object.assign(customer, { name: input.name, birthDate: input.birthDate, updatedAt: createdAt });
      const createdSession: CustomerSessionRecord = {
        id: nextSessionId++,
        customerId: customer.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt,
        updatedAt: createdAt
      };
      sessions.push(createdSession);
      return { customer, session: createdSession };
    },
    async findActiveSession(tokenHash, at) {
      const session = sessions.find(
        (candidate) =>
          candidate.tokenHash === tokenHash &&
          candidate.revokedAt === null &&
          candidate.expiresAt > at
      );
      if (session === undefined) return null;
      session.lastUsedAt = at;
      return lookup(session);
    },
    async revokeSession(tokenHash, at) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
      if (session !== undefined) session.revokedAt = at;
    },
    async cleanupExpiredSessions() {
      return undefined;
    }
  };
}

function createOrderRepository(totalMinor = 45_050, loyaltyRedemption?: OrderAggregate["loyaltyRedemption"]): OrderRepository & { readonly aggregate: OrderAggregate } {
  const order: OrderRecord = {
    id: 7,
    customerId: 1,
    pickupLocationId: "main-grill",
    pickupLocationName: "Основная точка",
    pickupLocationAddress: "Основная точка",
    pickupLocationTimezone: "Europe/Moscow",
    pickupSlotId: "main-grill-2026-09-01-1800",
    pickupSlotLabel: "Сегодня, 18:00–18:30",
    pickupSlotStartsAt: new Date("2026-09-01T15:00:00.000Z"),
    pickupSlotEndsAt: new Date("2026-09-01T15:30:00.000Z"),
    status: "pending_payment",
    totalMinor,
    currency: "RUB",
    idempotencyKey: "order-key",
    payloadFingerprint: "a".repeat(64),
    createdAt: now,
    updatedAt: now
  };
  const aggregate: OrderAggregate = {
    order,
    items: [{
      id: 1,
      orderId: 7,
      productId: 1,
      productName: "Шашлык",
      unitPriceMinor: 45_050,
      quantity: 1,
      lineTotalMinor: 45_050
    }],
    ...(loyaltyRedemption === undefined ? {} : { loyaltyRedemption })
  };
  return {
    aggregate,
    async findByIdempotencyKey() { return null; },
    async createOrder(input) { void input; return aggregate; },
    async listByCustomer(customerId) { return customerId === 1 ? [order] : []; },
    async findByCustomerAndId(customerId, orderId) {
      return customerId === order.customerId && orderId === order.id ? aggregate : null;
    }
  };
}

function createPaymentRepository(
  orderRepository: ReturnType<typeof createOrderRepository>
): PaymentRepository & { readonly records: PaymentAggregate[] } {
  const records: PaymentAggregate[] = [];
  const eventFingerprints = new Set<string>();
  let nextId = 1;
  return {
    records,
    async findByCustomerAndOrder(customerId, orderId) {
      return [...records].reverse().find(
        (record) => record.payment.customerId === customerId && record.payment.orderId === orderId
      ) ?? null;
    },
    async findByCustomerAndIdempotencyKey(customerId, idempotencyKey) {
      return records.find(
        (record) => record.payment.customerId === customerId && record.payment.idempotencyKey === idempotencyKey
      ) ?? null;
    },
    async findByProviderPaymentId(providerPaymentId) {
      return records.find((record) => record.payment.providerPaymentId === providerPaymentId) ?? null;
    },
    async createPayment(input: CreatePaymentInput, createProviderPayment) {
      const existing = await this.findByCustomerAndIdempotencyKey(input.customerId, input.idempotencyKey);
      if (existing !== null) return existing;
      const active = await this.findByCustomerAndOrder(input.customerId, input.orderId);
      if (active !== null && (active.payment.status === "pending" || active.payment.status === "succeeded")) return active;
      const providerPayment = await createProviderPayment();
      const payment: PaymentRecord = {
        id: nextId++,
        orderId: input.orderId,
        customerId: input.customerId,
        provider: input.provider,
        providerPaymentId: providerPayment.providerPaymentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: "pending",
        providerStatus: providerPayment.providerStatus,
        confirmationType: providerPayment.confirmationType,
        confirmationUrl: providerPayment.confirmationUrl,
        idempotencyKey: input.idempotencyKey,
        payloadFingerprint: input.payloadFingerprint,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      };
      const result = { payment };
      records.push(result);
      return result;
    },
    async processProviderEvent(input: PaymentProviderEventInput): Promise<PaymentEventResult> {
      const duplicate = eventFingerprints.has(input.eventFingerprint);
      const record = records.find((candidate) => candidate.payment.providerPaymentId === input.providerPaymentId);
      if (duplicate) return { duplicate: true, ignored: record === undefined, payment: record?.payment ?? null };
      eventFingerprints.add(input.eventFingerprint);
      if (record === undefined) return { duplicate: false, ignored: true, payment: null };
      if (record.payment.amountMinor !== input.amountMinor || record.payment.currency !== input.currency) {
        return { duplicate: false, ignored: true, payment: record.payment };
      }
      if (
        (record.payment.status === "succeeded" && input.providerStatus !== "succeeded") ||
        (record.payment.status === "canceled" && input.providerStatus !== "canceled")
      ) {
        return { duplicate: false, ignored: true, payment: record.payment };
      }
      const nextStatus = input.providerStatus === "succeeded"
        ? "succeeded"
        : input.providerStatus === "canceled" ? "canceled" : "pending";
      Object.assign(record.payment, {
        status: nextStatus,
        providerStatus: input.providerStatus,
        updatedAt: input.receivedAt
      });
      if (nextStatus === "succeeded") {
        Object.assign(orderRepository.aggregate.order, {
          status: "payment_confirmed",
          updatedAt: input.receivedAt
        });
      }
      return { duplicate: false, ignored: false, payment: record.payment };
    }
  };
}

function createCatalogRepository(): CatalogRepository & {
  product: { name: string; priceMinor: number; isVisible: boolean };
} {
  const product = { name: "Шашлык", priceMinor: 45_050, isVisible: true };
  return {
    product,
    async getCatalog(): Promise<CatalogSnapshot> { return { categories: [], products: [] }; },
    async getProductsForQuote(productIds) {
      return product.isVisible && productIds.includes(1)
        ? [{ id: 1, priceMinor: product.priceMinor }]
        : [];
    },
    async getProductsForCheckout(productIds) {
      return product.isVisible && productIds.includes(1)
        ? [{ id: 1, name: product.name, priceMinor: product.priceMinor }]
        : [];
    },
    async createCategory(input) { throw new Error(String(input)); },
    async updateCategory() { return null; },
    async createProduct(input) { throw new Error(String(input)); },
    async updateProduct() { return null; }
  };
}

function availableProducts(): OperationalAvailabilityProvider {
  return {
    async getProductAvailability(productIds) {
      return productIds.map((productId) => ({
        productId,
        iikoProductId: `iiko-${productId}`,
        status: "available",
        checkedAt: now.toISOString()
      }));
    }
  };
}

function providerDouble(amountMinor = 45_050): PaymentProvider & {
  readonly createPayment: ReturnType<typeof vi.fn>;
  readonly getPayment: ReturnType<typeof vi.fn>;
} {
  const createPayment = vi.fn(async () => ({
    providerPaymentId: "yk-payment-1",
    providerStatus: "pending" as const,
    amountMinor,
    currency: "RUB",
    confirmationType: "redirect" as const,
    confirmationUrl: "https://yoomoney.ru/checkout/example",
    metadata: { order_id: "7" },
    paid: false,
    test: true
  }));
  const getPayment = vi.fn(async () => ({
    providerPaymentId: "yk-payment-1",
    providerStatus: "succeeded" as const,
    amountMinor,
    currency: "RUB",
    confirmationType: null,
    confirmationUrl: null,
    metadata: { order_id: "7" },
    paid: true,
    test: true
  }));
  return { createPayment, getPayment };
}

async function identify(app: FastifyInstance, phone: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/auth/identify", payload: { phone, name: phone } });
  expect(response.statusCode).toBe(201);
  return String(response.headers["set-cookie"]).split(";")[0] ?? "";
}

describe("payment API", () => {
  let app: FastifyInstance;
  let orderRepository: ReturnType<typeof createOrderRepository>;
  let paymentRepository: ReturnType<typeof createPaymentRepository>;
  let provider: ReturnType<typeof providerDouble>;
  let catalogRepository: ReturnType<typeof createCatalogRepository>;

  beforeEach(() => {
    orderRepository = createOrderRepository();
    paymentRepository = createPaymentRepository(orderRepository);
    provider = providerDouble();
    catalogRepository = createCatalogRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      catalogRepository,
      availabilityProvider: availableProducts(),
      customerRepository: createCustomerRepository(),
      orderRepository,
      paymentRepository,
      paymentProvider: provider
    });
  });

  it("revalidates catalog and iiko before the first provider payment", async () => {
    const owner = await identify(app, "+79991234567");
    catalogRepository.product.priceMinor = 50_000;

    const stale = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "payment-key" },
      payload: {}
    });

    expect(stale.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(stale.json()).error.code).toBe("PAYMENT_NOT_ALLOWED");
    expect(provider.createPayment).not.toHaveBeenCalled();
    expect(paymentRepository.records).toHaveLength(0);
  });

  it("revalidates a discounted order against its persisted redemption snapshot", async () => {
    Object.assign(orderRepository.aggregate.order, { totalMinor: 40_050 });
    Object.assign(orderRepository.aggregate, {
      loyaltyRedemption: {
        id: 12,
        rewardCode: "discount-50",
        rewardName: "Скидка 50 ₽",
        discountMinor: 5_000,
        status: "succeeded"
      }
    });
    provider.createPayment.mockResolvedValueOnce({
      providerPaymentId: "yk-payment-1",
      providerStatus: "pending",
      amountMinor: 40_050,
      currency: "RUB",
      confirmationType: "redirect",
      confirmationUrl: "https://yoomoney.ru/checkout/example",
      metadata: { order_id: "7" },
      paid: false,
      test: true
    });
    const owner = await identify(app, "+79991234567");
    const response = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "discounted-payment-key" },
      payload: {}
    });

    expect(response.statusCode).toBe(201);
    expect(provider.createPayment).toHaveBeenCalledWith({
      orderId: 7,
      amountMinor: 40_050,
      currency: "RUB",
      idempotencyKey: expect.any(String)
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("enforces session/ownership, uses persisted amount and idempotently creates one pending payment", async () => {
    const anonymous = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { "idempotency-key": "payment-key" },
      payload: {}
    });
    expect(anonymous.statusCode).toBe(401);

    const owner = await identify(app, "+79991234567");
    const invalidClientTotal = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "payment-key" },
      payload: { amountMinor: 1, currency: "USD", providerPaymentId: "client-id" }
    });
    expect(invalidClientTotal.statusCode).toBe(400);

    const first = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "payment-key" },
      payload: {}
    });
    expect(first.statusCode).toBe(201);
    const firstState = PaymentStateResponseSchema.parse(first.json());
    expect(firstState).toMatchObject({
      order: { id: 7, status: "pending_payment" },
      payment: { status: "pending", amountMinor: 45_050, currency: "RUB" }
    });
    expect(provider.createPayment).toHaveBeenCalledTimes(1);
    expect(provider.createPayment).toHaveBeenCalledWith({
      orderId: 7,
      amountMinor: 45_050,
      currency: "RUB",
      idempotencyKey: expect.any(String)
    });
    expect(orderRepository.aggregate.order.status).toBe("pending_payment");

    const retry = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "payment-key" },
      payload: {}
    });
    expect(retry.statusCode).toBe(201);
    expect(PaymentStateResponseSchema.parse(retry.json()).payment?.id).toBe(firstState.payment?.id);
    expect(provider.createPayment).toHaveBeenCalledTimes(1);

    const otherCustomer = await identify(app, "+79991234568");
    const foreign = await app.inject({
      method: "GET",
      url: "/orders/7/payment",
      headers: { cookie: otherCustomer }
    });
    expect(foreign.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(foreign.json()).error.code).toBe("NOT_FOUND");
  });

  it("accepts only server-confirmed webhook state and deduplicates retries", async () => {
    const owner = await identify(app, "+79991234567");
    const created = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "payment-key" },
      payload: {}
    });
    expect(created.statusCode).toBe(201);

    const mismatched = await app.inject({
      method: "POST",
      url: "/webhooks/yookassa",
      payload: {
        type: "notification",
        event: "payment.succeeded",
        object: {
          id: "yk-payment-1",
          status: "succeeded",
          paid: true,
          amount: { value: "1.00", currency: "RUB" },
          created_at: now.toISOString(),
          metadata: { order_id: "7" },
          test: true
        }
      }
    });
    expect(mismatched.statusCode).toBe(409);
    expect(orderRepository.aggregate.order.status).toBe("pending_payment");

    const payload = {
      type: "notification",
      event: "payment.succeeded",
      object: {
        id: "yk-payment-1",
        status: "succeeded",
        paid: true,
        amount: { value: "450.50", currency: "RUB" },
        created_at: now.toISOString(),
        metadata: { order_id: "7" },
        test: true
      }
    };
    const success = await app.inject({ method: "POST", url: "/webhooks/yookassa", payload });
    expect(success.statusCode).toBe(200);
    expect(orderRepository.aggregate.order.status).toBe("payment_confirmed");

    const duplicate = await app.inject({ method: "POST", url: "/webhooks/yookassa", payload });
    expect(duplicate.statusCode).toBe(200);
    expect(paymentRepository.records[0]?.payment.status).toBe("succeeded");

    const state = await app.inject({
      method: "GET",
      url: "/orders/7/payment",
      headers: { cookie: owner }
    });
    expect(PaymentStateResponseSchema.parse(state.json())).toMatchObject({
      order: { status: "payment_confirmed" },
      payment: { status: "succeeded", providerStatus: "succeeded" }
    });

    const unknown = await app.inject({
      method: "POST",
      url: "/webhooks/yookassa",
      payload: { type: "notification", event: "refund.succeeded", object: {} }
    });
    expect(unknown.statusCode).toBe(200);
  });

  it("asks YooKassa to retry a notification that arrives before the local payment exists", async () => {
    const payload = {
      type: "notification",
      event: "payment.succeeded",
      object: {
        id: "yk-payment-1",
        status: "succeeded",
        paid: true,
        amount: { value: "450.50", currency: "RUB" },
        created_at: now.toISOString(),
        metadata: { order_id: "7" },
        test: true
      }
    };

    const early = await app.inject({ method: "POST", url: "/webhooks/yookassa", payload });
    expect(early.statusCode).toBe(503);
    expect(ApiErrorSchema.parse(early.json()).error.code).toBe("PAYMENT_UNAVAILABLE");
    expect(paymentRepository.records).toHaveLength(0);

    const owner = await identify(app, "+79991234567");
    const created = await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "payment-key" },
      payload: {}
    });
    expect(created.statusCode).toBe(201);

    const retry = await app.inject({ method: "POST", url: "/webhooks/yookassa", payload });
    expect(retry.statusCode).toBe(200);
    expect(paymentRepository.records[0]?.payment.status).toBe("succeeded");
    expect(orderRepository.aggregate.order.status).toBe("payment_confirmed");
  });

  it("rejects a webhook whose event and provider state disagree", async () => {
    const owner = await identify(app, "+79991234567");
    await app.inject({
      method: "POST",
      url: "/orders/7/payments",
      headers: { cookie: owner, "idempotency-key": "payment-key" },
      payload: {}
    });

    provider.getPayment.mockResolvedValueOnce({
      providerPaymentId: "yk-payment-1",
      providerStatus: "pending",
      amountMinor: 45_050,
      currency: "RUB",
      confirmationType: "redirect",
      confirmationUrl: "https://yoomoney.ru/checkout/example",
      metadata: { order_id: "7" },
      paid: false,
      test: true
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/yookassa",
      payload: {
        type: "notification",
        event: "payment.succeeded",
        object: {
          id: "yk-payment-1",
          status: "succeeded",
          paid: true,
          amount: { value: "450.50", currency: "RUB" },
          created_at: now.toISOString(),
          metadata: { order_id: "7" },
          test: true
        }
      }
    });

    expect(response.statusCode).toBe(409);
    expect(paymentRepository.records[0]?.payment.status).toBe("pending");
    expect(orderRepository.aggregate.order.status).toBe("pending_payment");
  });
});
