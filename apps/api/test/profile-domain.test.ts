import { describe, expect, it } from "vitest";

import type { CustomerProfileItemSnapshot } from "@vse-pro-zhar/database";

import { aggregateCustomerProfileStats, ProfileDataInvariantError } from "../src/profile/domain.js";

function item(input: Partial<CustomerProfileItemSnapshot["item"]> & Pick<CustomerProfileItemSnapshot["item"], "id" | "orderId" | "productId" | "productName" | "quantity">): CustomerProfileItemSnapshot["item"] {
  const unitPriceMinor = input.unitPriceMinor ?? 100;
  const quantity = input.quantity;
  return {
    id: input.id,
    orderId: input.orderId,
    productId: input.productId,
    productName: input.productName,
    unitPriceMinor,
    quantity,
    lineTotalMinor: input.lineTotalMinor ?? unitPriceMinor * quantity
  };
}

function snapshot(input: {
  readonly item: CustomerProfileItemSnapshot["item"];
  readonly orderId: number;
  readonly customerId?: number;
  readonly orderCreatedAt: string;
}): CustomerProfileItemSnapshot {
  return {
    item: input.item,
    orderCreatedAt: new Date(input.orderCreatedAt),
    orderId: input.orderId,
    customerId: input.customerId ?? 7
  };
}

describe("customer profile stats", () => {
  it("uses immutable snapshots and a deterministic product id tie-break", () => {
    const stats = aggregateCustomerProfileStats({
      customerId: 7,
      orderCount: 2,
      itemSnapshots: [
        snapshot({ item: item({ id: 1, orderId: 10, productId: 20, productName: "Старое название", quantity: 2 }), orderId: 10, orderCreatedAt: "2026-09-01T10:00:00.000Z" }),
        snapshot({ item: item({ id: 2, orderId: 11, productId: 20, productName: "Новое название в snapshot", quantity: 1 }), orderId: 11, orderCreatedAt: "2026-09-02T10:00:00.000Z" }),
        snapshot({ item: item({ id: 3, orderId: 11, productId: 19, productName: "Другой товар", quantity: 3 }), orderId: 11, orderCreatedAt: "2026-09-02T10:00:00.000Z" })
      ]
    });

    expect(stats).toEqual({ orderCount: 2, favoriteProduct: "Другой товар", nextMilestone: null });
  });

  it("returns a nullable favorite for customers without order items", () => {
    expect(aggregateCustomerProfileStats({ customerId: 7, orderCount: 0, itemSnapshots: [] })).toMatchObject({
      orderCount: 0,
      favoriteProduct: null
    });
  });

  it("fails closed for a foreign snapshot or malformed historical money", () => {
    expect(() => aggregateCustomerProfileStats({
      customerId: 7,
      orderCount: 1,
      itemSnapshots: [snapshot({ item: item({ id: 1, orderId: 10, productId: 1, productName: "Товар", quantity: 1 }), orderId: 10, customerId: 8, orderCreatedAt: "2026-09-01T10:00:00.000Z" })]
    })).toThrow(ProfileDataInvariantError);

    expect(() => aggregateCustomerProfileStats({
      customerId: 7,
      orderCount: 1,
      itemSnapshots: [snapshot({ item: item({ id: 1, orderId: 10, productId: 1, productName: "Товар", quantity: 1, lineTotalMinor: 101 }), orderId: 10, orderCreatedAt: "2026-09-01T10:00:00.000Z" })]
    })).toThrow(ProfileDataInvariantError);
  });
});
