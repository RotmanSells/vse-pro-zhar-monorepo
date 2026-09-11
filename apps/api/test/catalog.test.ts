import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  CartQuoteResponseSchema,
  CatalogResponseSchema,
  type CatalogProduct
} from "@vse-pro-zhar/contracts";
import type {
  CatalogCategoryMutationMetadata,
  CatalogCategoryInput,
  CatalogCategoryUpdate,
  CatalogProductInput,
  CatalogProductUpdate,
  CatalogRepository,
  CatalogSnapshot,
  CategoryRecord,
  ProductRecord
} from "@vse-pro-zhar/database";
import {
  CatalogCategoryIdempotencyConflictError,
  CatalogCategoryVersionConflictError
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie, type MemoryStaffState } from "./staff-fixtures.js";

function createCategory(
  id: number,
  slug: string,
  name: string,
  isVisible = true
): CategoryRecord {
  const now = new Date("2026-09-01T10:00:00.000Z");

  return {
    id,
    slug,
    name,
    sortOrder: id * 10,
    isVisible,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function createProduct(
  id: number,
  categoryId: number,
  name: string,
  isVisible = true
): ProductRecord {
  const now = new Date("2026-09-01T10:00:00.000Z");

  return {
    id,
    categoryId,
    name,
    description: "Сочное блюдо на углях",
    priceMinor: 45_000,
    imageUrl: null,
    emoji: "🥩",
    tag: "hit",
    isVisible,
    sortOrder: id,
    createdAt: now,
    updatedAt: now
  };
}

function createMemoryRepository(): CatalogRepository {
  let categoryRows: CategoryRecord[] = [
    createCategory(1, "shashlyk", "Шашлык"),
    createCategory(2, "hidden", "Скрытая категория", false)
  ];
  let productRows: ProductRecord[] = [
    createProduct(1, 1, "Видимый шашлык"),
    createProduct(2, 1, "Скрытый шашлык", false),
    createProduct(3, 2, "Товар скрытой категории")
  ];
  const categoryOperations = new Map<string, { readonly fingerprint: string; readonly categoryId: number }>();

  return {
    async getCatalog(options = {}): Promise<CatalogSnapshot> {
      return {
        categories: options.includeHidden
          ? categoryRows
          : categoryRows.filter((category) => category.isVisible),
        products: options.includeHidden
          ? productRows
          : productRows.filter((product) => product.isVisible)
      };
    },
    async getProductsForQuote(productIds) {
      return productRows
        .filter((product) => {
          const category = categoryRows.find(
            (candidate) => candidate.id === product.categoryId
          );
          return (
            productIds.includes(product.id) &&
            product.isVisible &&
            category?.isVisible === true
          );
        })
        .map((product) => ({
          id: product.id,
          priceMinor: product.priceMinor
        }));
    },
    async createCategory(input: CatalogCategoryInput, metadata?: CatalogCategoryMutationMetadata): Promise<CategoryRecord> {
      if (metadata !== undefined) {
        const known = categoryOperations.get(metadata.idempotencyKey);
        if (known !== undefined) {
          if (known.fingerprint !== metadata.payloadFingerprint) throw new CatalogCategoryIdempotencyConflictError();
          const repeated = categoryRows.find((category) => category.id === known.categoryId);
          if (repeated === undefined) throw new Error("category missing");
          return repeated;
        }
      }
      const category = createCategory(
        Math.max(...categoryRows.map((row) => row.id), 0) + 1,
        input.slug,
        input.name,
        input.isVisible
      );
      const persistedCategory = { ...category, sortOrder: input.sortOrder };
      categoryRows = [...categoryRows, persistedCategory];
      if (metadata !== undefined) {
        categoryOperations.set(metadata.idempotencyKey, {
          fingerprint: metadata.payloadFingerprint,
          categoryId: persistedCategory.id
        });
      }
      return persistedCategory;
    },
    async updateCategory(
      id: number,
      input: CatalogCategoryUpdate,
      metadata?: CatalogCategoryMutationMetadata
    ): Promise<CategoryRecord | null> {
      const current = categoryRows.find((category) => category.id === id);
      if (current === undefined) return null;
      if (metadata !== undefined) {
        const known = categoryOperations.get(metadata.idempotencyKey);
        if (known !== undefined) {
          if (known.fingerprint !== metadata.payloadFingerprint || known.categoryId !== id) throw new CatalogCategoryIdempotencyConflictError();
          return current;
        }
        if (input.expectedVersion !== current.version) throw new CatalogCategoryVersionConflictError();
        categoryOperations.set(metadata.idempotencyKey, {
          fingerprint: metadata.payloadFingerprint,
          categoryId: id
        });
      }
      const categoryInput: { name?: string; sortOrder?: number; isVisible?: boolean } = {};
      if (input.name !== undefined) categoryInput.name = input.name;
      if (input.sortOrder !== undefined) categoryInput.sortOrder = input.sortOrder;
      if (input.isVisible !== undefined) categoryInput.isVisible = input.isVisible;
      const updated = { ...current, ...categoryInput, version: current.version + (metadata === undefined ? 0 : 1), updatedAt: metadata?.now ?? new Date() };
      categoryRows = categoryRows.map((category) =>
        category.id === id ? updated : category
      );
      return updated;
    },
    async createProduct(input: CatalogProductInput): Promise<ProductRecord> {
      const now = new Date("2026-09-01T10:00:00.000Z");
      const product: ProductRecord = {
        id: Math.max(...productRows.map((row) => row.id), 0) + 1,
        ...input,
        createdAt: now,
        updatedAt: now
      };
      productRows = [...productRows, product];
      return product;
    },
    async updateProduct(
      id: number,
      input: CatalogProductUpdate
    ): Promise<ProductRecord | null> {
      const current = productRows.find((product) => product.id === id);
      if (current === undefined) return null;
      const updated = { ...current, ...input, updatedAt: new Date() };
      productRows = productRows.map((product) =>
        product.id === id ? updated : product
      );
      return updated;
    }
  };
}

describe("catalog API", () => {
  let app: FastifyInstance;
  let repository: CatalogRepository;
  let staff: MemoryStaffState;
  let adminSession: string;

  beforeEach(async () => {
    repository = createMemoryRepository();
    staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      catalogRepository: repository,
      staffRepository: staff.repository
    });
    adminSession = await staffCookie(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns only visible products and categories to Customer", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/catalog"
    });

    expect(response.statusCode).toBe(200);
    const catalog = CatalogResponseSchema.parse(response.json());
    expect(catalog.categories.map((category) => category.slug)).toEqual([
      "shashlyk"
    ]);
    expect(catalog.categories[0]?.products.map((product) => product.name)).toEqual([
      "Видимый шашлык"
    ]);
  });

  it("allows Admin to create, edit and hide a product", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/products",
      headers: { cookie: adminSession },
      payload: {
        categoryId: 1,
        name: "Новый кебаб",
        description: "Говядина и соус",
        priceMinor: 35_050,
        emoji: "🌯",
        tag: "new"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { product: CatalogProduct };
    expect(created.product.priceMinor).toBe(35_050);
    expect(created.product.isVisible).toBe(true);

    const editResponse = await app.inject({
      method: "PATCH",
      url: `/admin/products/${created.product.id}`,
      headers: { cookie: adminSession },
      payload: { name: "Обновлённый кебаб", priceMinor: 36_000 }
    });
    expect(editResponse.statusCode).toBe(200);
    expect(editResponse.json().product).toMatchObject({
      name: "Обновлённый кебаб",
      priceMinor: 36_000
    });

    const hideResponse = await app.inject({
      method: "PATCH",
      url: `/admin/products/${created.product.id}`,
      headers: { cookie: adminSession },
      payload: { isVisible: false }
    });
    expect(hideResponse.statusCode).toBe(200);

    const customerCatalog = CatalogResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/catalog" })).json()
    );
    expect(
      customerCatalog.categories.flatMap((category) => category.products).some(
        (product) => product.id === created.product.id
      )
    ).toBe(false);

    const adminCatalog = CatalogResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/admin/catalog", headers: { cookie: adminSession } })).json()
    );
    expect(
      adminCatalog.categories
        .flatMap((category) => category.products)
        .find((product) => product.id === created.product.id)?.isVisible
    ).toBe(false);
  });

  it("manages categories with Staff, strict fields, idempotency and version checks", async () => {
    const createPayload = {
      slug: "sauces",
      name: "Соусы",
      sortOrder: 25,
      isVisible: true
    };
    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/categories",
      headers: {
        cookie: adminSession,
        "idempotency-key": "catalog-category-create-1"
      },
      payload: createPayload
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      status: "confirmed",
      category: {
        slug: "sauces",
        name: "Соусы",
        sortOrder: 25,
        version: 1
      }
    });
    const categoryId = createResponse.json().category.id as number;

    const repeated = await app.inject({
      method: "POST",
      url: "/admin/categories",
      headers: {
        cookie: adminSession,
        "idempotency-key": "catalog-category-create-1"
      },
      payload: createPayload
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().category.id).toBe(categoryId);

    const idempotencyConflict = await app.inject({
      method: "POST",
      url: "/admin/categories",
      headers: {
        cookie: adminSession,
        "idempotency-key": "catalog-category-create-1"
      },
      payload: { ...createPayload, name: "Другие соусы" }
    });
    expect(idempotencyConflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(idempotencyConflict.json()).error.code).toBe(
      "CATALOG_CATEGORY_IDEMPOTENCY_CONFLICT"
    );

    const update = await app.inject({
      method: "PATCH",
      url: `/admin/categories/${categoryId}`,
      headers: {
        cookie: adminSession,
        "idempotency-key": "catalog-category-update-1"
      },
      payload: { name: "Соусы дома", expectedVersion: 1 }
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      status: "confirmed",
      category: { name: "Соусы дома", version: 2 }
    });

    const stale = await app.inject({
      method: "PATCH",
      url: `/admin/categories/${categoryId}`,
      headers: {
        cookie: adminSession,
        "idempotency-key": "catalog-category-update-stale"
      },
      payload: { name: "Не должно сохраниться", expectedVersion: 1 }
    });
    expect(stale.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(stale.json()).error.code).toBe(
      "CATALOG_CATEGORY_CONFLICT"
    );

    const invalid = await app.inject({
      method: "PATCH",
      url: `/admin/categories/${categoryId}`,
      headers: {
        cookie: adminSession,
        "idempotency-key": "catalog-category-update-invalid"
      },
      payload: { slug: "changed", expectedVersion: 2 }
    });
    expect(invalid.statusCode).toBe(400);

    const missingKey = await app.inject({
      method: "POST",
      url: "/admin/categories",
      headers: { cookie: adminSession },
      payload: createPayload
    });
    expect(missingKey.statusCode).toBe(400);
  });

  it("lists hidden categories with server-owned product counts", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/categories",
      headers: { cookie: adminSession }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "confirmed",
      categories: [
        { slug: "shashlyk", productCount: 2, version: 1 },
        { slug: "hidden", productCount: 1, isVisible: false, version: 1 }
      ]
    });
  });

  it("does not expose category management to anonymous requests", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/categories",
      payload: {
        slug: "forbidden",
        name: "Запрещённая",
        sortOrder: 1,
        isVisible: true
      }
    });
    expect(response.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
      "AUTHENTICATION_ERROR"
    );
  });

  it("allows browser preflight for Admin catalog mutations", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/admin/products/1",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("quotes current visible product prices in request order", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/products",
      headers: { cookie: adminSession },
      payload: {
        categoryId: 1,
        name: "Второй товар",
        description: "Для quote",
        priceMinor: 12_345,
        emoji: "🍢",
        tag: null
      }
    });
    const created = createResponse.json() as { product: CatalogProduct };

    const response = await app.inject({
      method: "POST",
      url: "/cart/quote",
      payload: {
        items: [
          { productId: created.product.id, quantity: 2 },
          { productId: 1, quantity: 3 }
        ],
        ignoredByBackend: "not accepted"
      }
    });

    expect(response.statusCode).toBe(400);

    const validResponse = await app.inject({
      method: "POST",
      url: "/cart/quote",
      payload: {
        items: [
          { productId: created.product.id, quantity: 2 },
          { productId: 1, quantity: 3 }
        ]
      }
    });

    expect(validResponse.statusCode).toBe(200);
    expect(CartQuoteResponseSchema.parse(validResponse.json())).toEqual({
      items: [
        {
          productId: created.product.id,
          quantity: 2,
          unitPriceMinor: 12_345,
          lineTotalMinor: 24_690
        },
        {
          productId: 1,
          quantity: 3,
          unitPriceMinor: 45_000,
          lineTotalMinor: 135_000
        }
      ],
      totalMinor: 159_690
    });
  });

  it("rejects an empty or duplicate quote request without echoing fields", async () => {
    const cases = [
      { items: [] },
      { items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }] },
      { items: [{ productId: 1, quantity: 1.5 }] },
      { items: [{ productId: 1, quantity: 0 }] },
      { items: [{ productId: 1, quantity: 1 }], secret: "do not echo" }
    ];

    for (const payload of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/cart/quote",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
        "VALIDATION_ERROR"
      );
      expect(response.body).not.toContain("do not echo");
    }
  });

  it("fails atomically when a product is hidden or missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/cart/quote",
      payload: {
        items: [
          { productId: 1, quantity: 2 },
          { productId: 2, quantity: 1 }
        ]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
      "CART_ITEM_UNAVAILABLE"
    );
    expect(response.body).not.toContain("totalMinor");

    const missingResponse = await app.inject({
      method: "POST",
      url: "/cart/quote",
      payload: { items: [{ productId: 999_999, quantity: 1 }] }
    });
    expect(missingResponse.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(missingResponse.json()).error.code).toBe(
      "CART_ITEM_UNAVAILABLE"
    );
  });

  it("uses the new Admin price on the next quote", async () => {
    const before = await app.inject({
      method: "POST",
      url: "/cart/quote",
      payload: { items: [{ productId: 1, quantity: 2 }] }
    });
    expect(CartQuoteResponseSchema.parse(before.json()).totalMinor).toBe(90_000);

    const update = await app.inject({
      method: "PATCH",
      url: "/admin/products/1",
      headers: { cookie: adminSession },
      payload: { priceMinor: 52_000 }
    });
    expect(update.statusCode).toBe(200);

    const after = await app.inject({
      method: "POST",
      url: "/cart/quote",
      payload: { items: [{ productId: 1, quantity: 2 }] }
    });
    expect(CartQuoteResponseSchema.parse(after.json())).toMatchObject({
      items: [
        {
          productId: 1,
          unitPriceMinor: 52_000,
          lineTotalMinor: 104_000
        }
      ],
      totalMinor: 104_000
    });
  });

  it("rejects cross-origin Admin catalog mutations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/products",
      headers: { origin: "https://attacker.example" },
      payload: {
        categoryId: 1,
        name: "Cross-origin product",
        description: "Must not be created",
        priceMinor: 10_000,
        emoji: "🥩",
        tag: null
      }
    });

    expect(response.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
      "AUTHENTICATION_ERROR"
    );
  });

  it("rejects malformed catalog mutations with a safe validation error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/products",
      headers: { cookie: adminSession },
      payload: {
        categoryId: 1,
        name: "Блюдо",
        description: "",
        priceMinor: 450.5,
        secret: "must not be echoed"
      }
    });

    expect(response.statusCode).toBe(400);
    const error = ApiErrorSchema.parse(response.json());
    expect(error.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("returns an explicit unavailable state when PostgreSQL is not configured", async () => {
    const unavailableApp = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false
    });

    const response = await unavailableApp.inject({
      method: "GET",
      url: "/catalog"
    });

    expect(response.statusCode).toBe(503);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
      "SERVICE_UNAVAILABLE"
    );

    const quoteResponse = await unavailableApp.inject({
      method: "POST",
      url: "/cart/quote",
      payload: { items: [{ productId: 1, quantity: 1 }] }
    });
    expect(quoteResponse.statusCode).toBe(503);
    expect(ApiErrorSchema.parse(quoteResponse.json()).error.code).toBe(
      "SERVICE_UNAVAILABLE"
    );
    await unavailableApp.close();
  });
});
