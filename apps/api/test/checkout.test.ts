import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  CheckoutOptionsResponseSchema,
  CheckoutQuoteResponseSchema
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
  ProductRecord
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import {
  type OperationalAvailabilityProvider
} from "../src/checkout/availability.js";
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

function createCatalogRepository(): CatalogRepository & {
  readonly product: ProductRecord;
} {
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
    async updateCategory(
      id: number,
      input: CatalogCategoryUpdate
    ): Promise<CategoryRecord | null> {
      void id;
      void input;
      return null;
    },
    async createProduct(input: CatalogProductInput): Promise<ProductRecord> {
      return { ...product, ...input };
    },
    async updateProduct(
      id: number,
      input: CatalogProductUpdate
    ): Promise<ProductRecord | null> {
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
    async upsertCustomerAndCreateSession(
      input: CustomerUpsertInput,
      session,
      createdAt
    ): Promise<CustomerSessionLookup> {
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

function createAvailableProvider(): OperationalAvailabilityProvider {
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

async function identify(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/identify",
    payload: { phone: "+79991234567", name: "Анна" }
  });
  expect(response.statusCode).toBe(201);
  return String(response.headers["set-cookie"]).split(";")[0] ?? "";
}

describe("checkout API", () => {
  let app: FastifyInstance;
  let catalogRepository: ReturnType<typeof createCatalogRepository>;

  beforeEach(() => {
    catalogRepository = createCatalogRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      catalogRepository,
      customerRepository: createCustomerRepository(),
      availabilityProvider: createAvailableProvider()
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires a server session and returns backend-owned options and quote", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/checkout/options" });
    expect(anonymous.statusCode).toBe(401);

    const cookie = await identify(app);
    const optionsResponse = await app.inject({
      method: "GET",
      url: "/checkout/options",
      headers: { cookie }
    });
    expect(optionsResponse.statusCode).toBe(200);
    const options = CheckoutOptionsResponseSchema.parse(optionsResponse.json());
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");

    const quoteResponse = await app.inject({
      method: "POST",
      url: "/checkout/quote",
      headers: { cookie },
      payload: {
        items: [{ productId: 1, quantity: 2 }],
        pickup: { locationId: location.id, slotId: slot.id }
      }
    });
    expect(quoteResponse.statusCode).toBe(200);
    expect(CheckoutQuoteResponseSchema.parse(quoteResponse.json())).toMatchObject({
      customer: { phone: "+79991234567", name: "Анна" },
      items: [
        {
          productId: 1,
          productName: "Шашлык",
          unitPriceMinor: 45_050,
          lineTotalMinor: 90_100
        }
      ],
      totalMinor: 90_100,
      pickup: { location: { id: location.id }, slot: { id: slot.id } }
    });
  });

  it("ignores no client total and rejects invalid or unavailable pickup atomically", async () => {
    const cookie = await identify(app);
    const options = CheckoutOptionsResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/checkout/options", headers: { cookie } })).json()
    );
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");

    const extraField = await app.inject({
      method: "POST",
      url: "/checkout/quote",
      headers: { cookie },
      payload: {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: location.id, slotId: slot.id },
        totalMinor: 1
      }
    });
    expect(extraField.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(extraField.json()).error.code).toBe("VALIDATION_ERROR");

    const unavailableSlot = await app.inject({
      method: "POST",
      url: "/checkout/quote",
      headers: { cookie },
      payload: {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: location.id, slotId: "main-grill-2099-1200" }
      }
    });
    expect(unavailableSlot.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(unavailableSlot.json()).error.code).toBe(
      "PICKUP_OPTION_UNAVAILABLE"
    );
  });

  it("re-reads current catalog data and fails closed for unknown availability", async () => {
    const cookie = await identify(app);
    const options = CheckoutOptionsResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/checkout/options", headers: { cookie } })).json()
    );
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");

    catalogRepository.product.priceMinor = 50_000;
    catalogRepository.product.name = "Новый шашлык";
    const quote = await app.inject({
      method: "POST",
      url: "/checkout/quote",
      headers: { cookie },
      payload: {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: location.id, slotId: slot.id }
      }
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.json()).toMatchObject({
      items: [{ productName: "Новый шашлык", unitPriceMinor: 50_000 }],
      totalMinor: 50_000
    });

    const unavailableApp = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      catalogRepository,
      customerRepository: createCustomerRepository()
    });
    try {
      const unavailableCookie = await identify(unavailableApp);
      const unavailableOptions = CheckoutOptionsResponseSchema.parse(
        (await unavailableApp.inject({
          method: "GET",
          url: "/checkout/options",
          headers: { cookie: unavailableCookie }
        })).json()
      );
      const unavailableLocation = unavailableOptions.locations[0];
      const unavailableSlot = unavailableLocation?.slots[0];
      if (unavailableLocation === undefined || unavailableSlot === undefined) {
        throw new Error("Expected pickup slot");
      }
      const response = await unavailableApp.inject({
        method: "POST",
        url: "/checkout/quote",
        headers: { cookie: unavailableCookie },
        payload: {
          items: [{ productId: 1, quantity: 1 }],
          pickup: {
            locationId: unavailableLocation.id,
            slotId: unavailableSlot.id
          }
        }
      });
      expect(response.statusCode).toBe(409);
      expect(ApiErrorSchema.parse(response.json()).error.code).toBe("CHECKOUT_UNAVAILABLE");
    } finally {
      await unavailableApp.close();
    }
  });

  it("fails closed for products in hidden categories through the catalog fallback", async () => {
    const fallbackRepository: CatalogRepository = { ...catalogRepository };
    delete fallbackRepository.getProductsForCheckout;
    const hiddenCategoryApp = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      catalogRepository: {
        ...fallbackRepository,
        async getCatalog(): Promise<CatalogSnapshot> {
          return {
            categories: [{ ...categoryRow(), isVisible: false }],
            products: [productRow()]
          };
        }
      },
      customerRepository: createCustomerRepository(),
      availabilityProvider: createAvailableProvider()
    });

    try {
      const cookie = await identify(hiddenCategoryApp);
      const options = CheckoutOptionsResponseSchema.parse(
        (await hiddenCategoryApp.inject({
          method: "GET",
          url: "/checkout/options",
          headers: { cookie }
        })).json()
      );
      const location = options.locations[0];
      const slot = location?.slots[0];
      if (location === undefined || slot === undefined) {
        throw new Error("Expected pickup slot");
      }

      const response = await hiddenCategoryApp.inject({
        method: "POST",
        url: "/checkout/quote",
        headers: { cookie },
        payload: {
          items: [{ productId: 1, quantity: 1 }],
          pickup: { locationId: location.id, slotId: slot.id }
        }
      });

      expect(response.statusCode).toBe(409);
      expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
        "CART_ITEM_UNAVAILABLE"
      );
    } finally {
      await hiddenCategoryApp.close();
    }
  });

  it("uses one catalog snapshot for product name and price", async () => {
    const cookie = await identify(app);
    const options = CheckoutOptionsResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/checkout/options", headers: { cookie } })).json()
    );
    const location = options.locations[0];
    const slot = location?.slots[0];
    if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");

    catalogRepository.getProductsForQuote = async () => [{ id: 1, priceMinor: 1 }];
    catalogRepository.getProductsForCheckout = async () => [{
      id: 1,
      name: "Согласованный шашлык",
      priceMinor: 50_000
    }];
    const response = await app.inject({
      method: "POST",
      url: "/checkout/quote",
      headers: { cookie },
      payload: {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: location.id, slotId: slot.id }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ productName: "Согласованный шашлык", unitPriceMinor: 50_000 }],
      totalMinor: 50_000
    });
  });

  it("returns a safe 503 when the availability provider fails", async () => {
    const failingApp = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      catalogRepository,
      customerRepository: createCustomerRepository(),
      availabilityProvider: {
        getProductAvailability: async () => {
          throw new Error("provider detail must not escape");
        }
      }
    });
    try {
      const cookie = await identify(failingApp);
      const options = CheckoutOptionsResponseSchema.parse(
        (await failingApp.inject({ method: "GET", url: "/checkout/options", headers: { cookie } })).json()
      );
      const location = options.locations[0];
      const slot = location?.slots[0];
      if (location === undefined || slot === undefined) throw new Error("Expected pickup slot");
      const response = await failingApp.inject({
        method: "POST",
        url: "/checkout/quote",
        headers: { cookie },
        payload: {
          items: [{ productId: 1, quantity: 1 }],
          pickup: { locationId: location.id, slotId: slot.id }
        }
      });
      expect(response.statusCode).toBe(503);
      expect(JSON.stringify(response.json())).not.toContain("provider detail");
    } finally {
      await failingApp.close();
    }
  });

  it("rejects a pickup slot that expires while availability is being checked", async () => {
    let currentNow = now;
    const expiringApp = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => currentNow,
      catalogRepository,
      customerRepository: createCustomerRepository(),
      availabilityProvider: {
        async getProductAvailability(productIds) {
          currentNow = new Date("2026-09-01T07:30:00.000Z");
          return productIds.map((productId) => ({
            productId,
            iikoProductId: `iiko-${productId}`,
            status: "available",
            checkedAt: currentNow.toISOString()
          }));
        }
      }
    });

    try {
      const cookie = await identify(expiringApp);
      const options = CheckoutOptionsResponseSchema.parse(
        (await expiringApp.inject({
          method: "GET",
          url: "/checkout/options",
          headers: { cookie }
        })).json()
      );
      const location = options.locations[0];
      const slot = location?.slots[0];
      if (location === undefined || slot === undefined) {
        throw new Error("Expected pickup slot");
      }

      const response = await expiringApp.inject({
        method: "POST",
        url: "/checkout/quote",
        headers: { cookie },
        payload: {
          items: [{ productId: 1, quantity: 1 }],
          pickup: { locationId: location.id, slotId: slot.id }
        }
      });

      expect(response.statusCode).toBe(409);
      expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
        "PICKUP_OPTION_UNAVAILABLE"
      );
    } finally {
      await expiringApp.close();
    }
  });
});
