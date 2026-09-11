import { describe, expect, it } from "vitest";

import {
  CartQuoteRequestSchema,
  CartQuoteResponseSchema,
  CartStoragePayloadSchema
} from "../src/cart.js";

describe("cart contracts", () => {
  it("accepts a quote with integer minor-unit amounts", () => {
    expect(
      CartQuoteRequestSchema.safeParse({
        items: [{ productId: 10, quantity: 2 }]
      }).success
    ).toBe(true);
    expect(
      CartQuoteResponseSchema.safeParse({
        items: [
          {
            productId: 10,
            quantity: 2,
            unitPriceMinor: 45_050,
            lineTotalMinor: 90_100
          }
        ],
        totalMinor: 90_100
      }).success
    ).toBe(true);
  });

  it("rejects empty, duplicate, unknown and invalid quantity payloads", () => {
    const invalidRequests: unknown[] = [
      { items: [] },
      { items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }] },
      { items: [{ productId: 1, quantity: 0 }] },
      { items: [{ productId: 1, quantity: -1 }] },
      { items: [{ productId: 1, quantity: 1.5 }] },
      { items: [{ productId: 1, quantity: 100 }] },
      { items: [{ productId: 1, quantity: 1, priceMinor: 500 }] },
      { items: [{ productId: 0, quantity: 1 }] }
    ];

    for (const input of invalidRequests) {
      expect(CartQuoteRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates quote line totals and aggregate total", () => {
    const base = {
      items: [
        {
          productId: 1,
          quantity: 2,
          unitPriceMinor: 500,
          lineTotalMinor: 1_000
        }
      ],
      totalMinor: 1_000
    };

    expect(CartQuoteResponseSchema.safeParse(base).success).toBe(true);
    expect(
      CartQuoteResponseSchema.safeParse({
        ...base,
        items: [{ ...base.items[0], lineTotalMinor: 999 }]
      }).success
    ).toBe(false);
    expect(
      CartQuoteResponseSchema.safeParse({ ...base, totalMinor: 999 }).success
    ).toBe(false);
    expect(
      CartQuoteResponseSchema.safeParse({
        ...base,
        items: [{ ...base.items[0], unitPriceMinor: 1.5 }]
      }).success
    ).toBe(false);
  });

  it("accepts only the versioned reference-only storage payload", () => {
    expect(
      CartStoragePayloadSchema.safeParse({
        version: 1,
        items: [{ productId: 2, quantity: 3 }]
      }).success
    ).toBe(true);
    expect(
      CartStoragePayloadSchema.safeParse({
        version: 2,
        items: [{ productId: 2, quantity: 3 }]
      }).success
    ).toBe(false);
    expect(
      CartStoragePayloadSchema.safeParse({
        version: 1,
        items: [{ productId: 2, quantity: 3, name: "fake" }]
      }).success
    ).toBe(false);
  });
});
