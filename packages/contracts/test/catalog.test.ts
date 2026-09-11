import { describe, expect, it } from "vitest";

import {
  CatalogAdminCategoriesResponseSchema,
  CatalogAdminCategoryResponseSchema,
  CatalogCategoryIdempotencyKeySchema,
  CatalogCategoryInputSchema,
  CatalogCategoryUpdateSchema,
  CatalogProductInputSchema,
  CatalogResponseSchema
} from "../src/catalog.js";

const category = {
  id: 1,
  slug: "shashlyk",
  name: "Шашлык",
  sortOrder: 10,
  isVisible: true
};

describe("catalog contracts", () => {
  it("validates server-owned Admin category mutation fields", () => {
    expect(CatalogCategoryInputSchema.parse({
      slug: "new-category",
      name: "Новая категория",
      sortOrder: 20,
      isVisible: true
    })).toEqual({
      slug: "new-category",
      name: "Новая категория",
      sortOrder: 20,
      isVisible: true
    });
    expect(CatalogCategoryUpdateSchema.parse({
      name: "Обновлённая категория",
      expectedVersion: 3
    })).toEqual({ name: "Обновлённая категория", expectedVersion: 3 });
    expect(() => CatalogCategoryUpdateSchema.parse({ slug: "changed", expectedVersion: 1 })).toThrow();
    expect(() => CatalogCategoryUpdateSchema.parse({ name: "Категория", expectedVersion: 0 })).toThrow();
    expect(() => CatalogCategoryInputSchema.parse({
      slug: "new-category",
      name: "Категория",
      sortOrder: 0,
      isVisible: true,
      productCount: 2,
      version: 1
    })).toThrow();
    expect(() => CatalogCategoryIdempotencyKeySchema.parse(" ")).toThrow();
  });

  it("requires confirmed Admin category response metadata", () => {
    const date = "2026-09-01T10:00:00.000Z";
    const response = CatalogAdminCategoryResponseSchema.parse({
      status: "confirmed",
      category: {
        id: 1,
        slug: "shashlyk",
        name: "Шашлык",
        sortOrder: 10,
        isVisible: true,
        version: 2,
        createdAt: date,
        updatedAt: date
      }
    });
    expect(response.category.version).toBe(2);
    expect(() => CatalogAdminCategoriesResponseSchema.parse({
      status: "confirmed",
      categories: [{ ...response.category, productCount: 1 }]
    })).not.toThrow();
  });

  it("accepts a catalog response with minor-unit prices", () => {
    const response = CatalogResponseSchema.parse({
      categories: [
        {
          ...category,
          products: [
            {
              id: 1,
              categoryId: 1,
              name: "Шашлык из свинины",
              description: "Сочный шашлык на углях, 200г",
              priceMinor: 45_050,
              imageUrl: null,
              emoji: "🥩",
              tag: "hit",
              isVisible: true,
              sortOrder: 0
            }
          ]
        }
      ]
    });

    expect(response.categories[0]?.products[0]?.priceMinor).toBe(45_050);
  });

  it("applies safe defaults for new products", () => {
    expect(
      CatalogProductInputSchema.parse({
        categoryId: 1,
        name: "Овощи на гриле",
        description: ""
        ,
        priceMinor: 29_000
      })
    ).toMatchObject({
      imageUrl: null,
      emoji: "🍽️",
      tag: null,
      isVisible: true,
      sortOrder: 0
    });
  });

  it("rejects floating-point money and unknown fields", () => {
    expect(() =>
      CatalogProductInputSchema.parse({
        categoryId: 1,
        name: "Блюдо",
        description: "",
        priceMinor: 450.5
      })
    ).toThrow();

    expect(() =>
      CatalogProductInputSchema.parse({
        categoryId: 1,
        name: "Блюдо",
        description: "",
        priceMinor: 45_000,
        total: 450
      })
    ).toThrow();
  });

  it("accepts only http(s) image URLs", () => {
    expect(() =>
      CatalogProductInputSchema.parse({
        categoryId: 1,
        name: "Блюдо",
        description: "",
        priceMinor: 45_000,
        imageUrl: "javascript:alert(1)"
      })
    ).toThrow();
  });
});
