import { describe, expect, it } from "vitest";

import {
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
