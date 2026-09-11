import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  CheckoutOptionsResponseSchema,
  OrderResponseSchema
} from "@vse-pro-zhar/contracts";
import type {
  CatalogCategoryInput,
  CatalogCategoryUpdate,
  CatalogCheckoutProduct,
  CatalogProductInput,
  CatalogProductUpdate,
  CatalogRepository,
  CatalogSnapshot,
  CategoryRecord,
  CustomerRecord,
  CustomerRepository,
  CustomerSessionLookup,
  CustomerSessionRecord,
  CustomerUpsertInput,
  CreateOrderInput,
  OrderAggregate,
  OrderItemRecord,
  OrderRecord,
  OrderRepository,
  ProductRecord
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import type { OperationalAvailabilityProvider } from "../src/checkout/availability.js";
import { loadConfig } from "../src/config/env.js";

const now = new Date("2026-09-01T07:00:00.000Z");

function categoryRow(): CategoryRecord {
  return {
    id: 1,
    slug: "shashlyk",
    name: "Шашлык",
    sortOrder: 1,
    isVisible: true,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function productRow(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: 1,
    categoryId: 1,
    name: "Шашлык",
    description: "На углях",
    priceMinor: 45_050,
    imageUrl: null,
    emoji: "🥩",
    tag: null,
    isVisible: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createCatalogRepository(): CatalogRepository & { product: ProductRecord } {
  const product = productRow();
  const category = categoryRow();
  return {
    product,
    async getCatalog(options = {}): Promise<CatalogSnapshot> {
      return {
        categories: options.includeHidden || category.isVisible ? [category] : [],
        products: options.includeHidden || product.isVisible ? [product] : []
      };
    },
    async getProductsForQuote(productIds) {
      return productIds.includes(product.id) && product.isVisible
        ? [{ id: product.id, priceMinor: product.priceMinor }]
        : [];
    },
    async getProductsForCheckout(productIds): Promise<readonly CatalogCheckoutProduct[]> {
      return productIds.includes(product.id) && product.isVisible
        ? [{ id: product.id, name: product.name, priceMinor: product.priceMinor }]
        : [];
    },
    async createCategory(input: CatalogCategoryInput): Promise<CategoryRecord> {
      return { ...category, ...input };
    },
    async updateCategory(id: number, input: CatalogCategoryUpdate): Promise<CategoryRecord | null> {
      void id;
      void input;
      return null;
    },
    async createProduct(input: CatalogProductInput): Promise<ProductRecord> {
      return { ...product, ...input };
    },
    async updateProduct(id: number, input: CatalogProductUpdate): Promise<ProductRecord | null> {
      void id;
      void input;
      return null;
    }
  };
}

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
      const customer = customers.find((candidate) => candidate.phone === input.phone);
      const record = customer ?? {
        id: nextCustomerId++,
        phone: input.phone,
        name: input.name,
        birthDate: input.birthDate,
        createdAt,
        updatedAt: createdAt
      };
      if (customer === undefined) customers.push(record);
      else Object.assign(customer, { name: input.name, birthDate: input.birthDate, updatedAt: createdAt });
      const createdSession: CustomerSessionRecord = {
        id: nextSessionId++,
        customerId: record.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt,
        updatedAt: createdAt
      };
      sessions.push(createdSession);
      return { customer: record, session: createdSession };
    },
    async findActiveSession(tokenHash, at) {
      const session = sessions.find(
        (candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null && candidate.expiresAt > at
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

function createOrderRepository(): OrderRepository & { readonly records: OrderAggregate[] } {
  const records: OrderAggregate[] = [];
  let nextOrderId = 1;
  let nextItemId = 1;
  return {
    records,
    async findByIdempotencyKey(customerId, idempotencyKey) {
      return records.find(
        (record) => record.order.customerId === customerId && record.order.idempotencyKey === idempotencyKey
      ) ?? null;
    },
    async createOrder(input: CreateOrderInput) {
      const existing = records.find(
        (record) => record.order.customerId === input.customerId && record.order.idempotencyKey === input.idempotencyKey
      );
      if (existing !== undefined) return existing;
      const order: OrderRecord = {
        id: nextOrderId++,
        customerId: input.customerId,
        pickupLocationId: input.pickup.locationId,
        pickupLocationName: input.pickup.locationName,
        pickupLocationAddress: input.pickup.locationAddress,
        pickupLocationTimezone: input.pickup.locationTimezone,
        pickupSlotId: input.pickup.slotId,
        pickupSlotLabel: input.pickup.slotLabel,
        pickupSlotStartsAt: input.pickup.slotStartsAt,
        pickupSlotEndsAt: input.pickup.slotEndsAt,
        status: input.status,
        totalMinor: input.totalMinor,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        payloadFingerprint: input.payloadFingerprint,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      };
      const items: OrderItemRecord[] = input.items.map((item) => ({
        id: nextItemId++,
        orderId: order.id,
        productId: item.productId,
        productName: item.productName,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor
      }));
      const aggregate = { order, items };
      records.push(aggregate);
      return aggregate;
    },
    async listByCustomer(customerId) {
      return records.filter((record) => record.order.customerId === customerId).map((record) => record.order);
    },
    async findByCustomerAndId(customerId, orderId) {
      return records.find((record) => record.order.customerId === customerId && record.order.id === orderId) ?? null;
    }
  };
}

function createAvailabilityProvider(): OperationalAvailabilityProvider {
  return {
    async getProductAvailability(productIds) {
      return productIds.map((productId) => ({
        productId,
        iikoProductId: `iiko-${productId}`,
        status: "available",
        checkedAt: "2026-09-01T06:59:00.000Z"
      }));
    }
  };
}

async function identify(app: FastifyInstance, phone: string, name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/identify",
    payload: { phone, name }
  });
  expect(response.statusCode).toBe(201);
  return String(response.headers["set-cookie"]).split(";")[0] ?? "";
}

describe("orders API", () => {
  let app: FastifyInstance;
  let catalogRepository: ReturnType<typeof createCatalogRepository>;
  let orderRepository: ReturnType<typeof createOrderRepository>;
  let currentNow = now;

  beforeEach(() => {
    currentNow = now;
    catalogRepository = createCatalogRepository();
    orderRepository = createOrderRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => currentNow,
      catalogRepository,
      customerRepository: createCustomerRepository(),
      orderRepository,
      availabilityProvider: createAvailabilityProvider()
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires a live session and creates one backend-owned pending-payment order idempotently", async () => {
    const anonymous = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": "anonymous-key" },
      payload: { items: [{ productId: 1, quantity: 1 }], pickup: { locationId: "main-grill", slotId: "missing" } }
    });
    expect(anonymous.statusCode).toBe(401);

    const cookie = await identify(app, "+79991234567", "Анна");
    const options = CheckoutOptionsResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/checkout/options", headers: { cookie } })).json()
    );
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");

    catalogRepository.product.priceMinor = 50_000;
    catalogRepository.product.name = "Новый шашлык";
    const payload = {
      items: [{ productId: 1, quantity: 2 }],
      pickup: { locationId: location.id, slotId: slot.id }
    };
    const first = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie, "idempotency-key": "order-key-1" },
      payload
    });
    expect(first.statusCode).toBe(201);
    const firstOrder = OrderResponseSchema.parse(first.json());
    expect(firstOrder).toMatchObject({
      status: "pending_payment",
      totalMinor: 100_000,
      currency: "RUB",
      items: [{ productName: "Новый шашлык", unitPriceMinor: 50_000, lineTotalMinor: 100_000 }]
    });
    expect(orderRepository.records).toHaveLength(1);

    catalogRepository.product.priceMinor = 1;
    const retry = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie, "idempotency-key": "order-key-1" },
      payload
    });
    expect(retry.statusCode).toBe(201);
    expect(OrderResponseSchema.parse(retry.json()).id).toBe(firstOrder.id);
    expect(orderRepository.records).toHaveLength(1);

    const conflict = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie, "idempotency-key": "order-key-1" },
      payload: { ...payload, items: [{ productId: 1, quantity: 1 }] }
    });
    expect(conflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("lists and reads only the authenticated customer's orders", async () => {
    const annaCookie = await identify(app, "+79991234567", "Анна");
    const bobCookie = await identify(app, "+79991234568", "Борис");
    const options = CheckoutOptionsResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/checkout/options", headers: { cookie: annaCookie } })).json()
    );
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");
    const created = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie: annaCookie, "idempotency-key": "anna-order" },
      payload: {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: location.id, slotId: slot.id }
      }
    });
    expect(created.statusCode).toBe(201);
    const order = OrderResponseSchema.parse(created.json());

    const annaOrders = await app.inject({ method: "GET", url: "/orders", headers: { cookie: annaCookie } });
    expect(annaOrders.statusCode).toBe(200);
    expect(annaOrders.json().orders).toHaveLength(1);
    expect(annaOrders.json().orders[0].id).toBe(order.id);

    const bobOrders = await app.inject({ method: "GET", url: "/orders", headers: { cookie: bobCookie } });
    expect(bobOrders.statusCode).toBe(200);
    expect(bobOrders.json().orders).toHaveLength(0);

    const forbidden = await app.inject({ method: "GET", url: `/orders/${order.id}`, headers: { cookie: bobCookie } });
    expect(forbidden.statusCode).toBe(404);

    const anonymous = await app.inject({ method: "GET", url: "/orders" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("caps order history at the public contract limit", async () => {
    const cookie = await identify(app, "+79991234567", "Анна");
    for (let index = 0; index < 101; index += 1) {
      await orderRepository.createOrder({
        customerId: 1,
        idempotencyKey: `history-${index}`,
        payloadFingerprint: String(index).padStart(64, "0"),
        pickup: {
          locationId: "main-grill",
          locationName: "Основная точка",
          locationAddress: "Основная точка самовывоза",
          locationTimezone: "Europe/Moscow",
          slotId: `history-slot-${index}`,
          slotLabel: "Сегодня, 18:00–18:30",
          slotStartsAt: new Date("2026-09-01T15:00:00.000Z"),
          slotEndsAt: new Date("2026-09-01T15:30:00.000Z")
        },
        items: [{
          productId: 1,
          productName: "Шашлык",
          unitPriceMinor: 45_050,
          quantity: 1,
          lineTotalMinor: 45_050
        }],
        totalMinor: 45_050,
        currency: "RUB",
        status: "pending_payment",
        createdAt: new Date(now.getTime() + index)
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/orders",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().orders).toHaveLength(100);
  });

  it("rejects empty, hidden and unavailable order inputs without creating a record", async () => {
    const cookie = await identify(app, "+79991234567", "Анна");
    const options = CheckoutOptionsResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/checkout/options", headers: { cookie } })).json()
    );
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");
    const base = { pickup: { locationId: location.id, slotId: slot.id } };

    const empty = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie, "idempotency-key": "empty" },
      payload: { ...base, items: [] }
    });
    expect(empty.statusCode).toBe(400);

    catalogRepository.product.isVisible = false;
    const hidden = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie, "idempotency-key": "hidden" },
      payload: { ...base, items: [{ productId: 1, quantity: 1 }] }
    });
    expect(hidden.statusCode).toBe(409);
    expect(orderRepository.records).toHaveLength(0);
  });

  it("rejects expired and revoked sessions at the order boundary", async () => {
    const cookie = await identify(app, "+79991234567", "Анна");
    const options = CheckoutOptionsResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/checkout/options", headers: { cookie } })).json()
    );
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");
    const payload = {
      items: [{ productId: 1, quantity: 1 }],
      pickup: { locationId: location.id, slotId: slot.id }
    };

    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    const revoked = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie, "idempotency-key": "revoked" },
      payload
    });
    expect(revoked.statusCode).toBe(401);

    const expiredCookie = await identify(app, "+79991234568", "Борис");
    currentNow = new Date("2027-10-01T07:00:00.000Z");
    const expired = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { cookie: expiredCookie, "idempotency-key": "expired" },
      payload
    });
    expect(expired.statusCode).toBe(401);
  });
});
