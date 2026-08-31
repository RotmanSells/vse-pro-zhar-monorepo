import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  CatalogResponseSchema,
  type CatalogProduct
} from "@vse-pro-zhar/contracts";
import type {
  CatalogCategoryInput,
  CatalogCategoryUpdate,
  CatalogProductInput,
  CatalogProductUpdate,
  CatalogRepository,
  CatalogSnapshot,
  CategoryRecord,
  ProductRecord
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";

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
    async createCategory(input: CatalogCategoryInput): Promise<CategoryRecord> {
      const category = createCategory(
        Math.max(...categoryRows.map((row) => row.id), 0) + 1,
        input.slug,
        input.name,
        input.isVisible
      );
      categoryRows = [...categoryRows, category];
      return category;
    },
    async updateCategory(
      id: number,
      input: CatalogCategoryUpdate
    ): Promise<CategoryRecord | null> {
      const current = categoryRows.find((category) => category.id === id);
      if (current === undefined) return null;
      const updated = { ...current, ...input, updatedAt: new Date() };
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

  beforeEach(() => {
    repository = createMemoryRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      catalogRepository: repository
    });
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
      (await app.inject({ method: "GET", url: "/admin/catalog" })).json()
    );
    expect(
      adminCatalog.categories
        .flatMap((category) => category.products)
        .find((product) => product.id === created.product.id)?.isVisible
    ).toBe(false);
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

  it("rejects malformed catalog mutations with a safe validation error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/products",
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
    await unavailableApp.close();
  });
});
