import { describe, expect, it } from "vitest";

import {
  IdempotencyKeySchema,
  OrderCreateRequestSchema,
  OrderResponseSchema,
  OrdersListResponseSchema
} from "../src/index.js";

const pickup = {
  location: {
    id: "main-grill",
    name: "Основная точка",
    address: "Основная точка самовывоза",
    timezone: "Europe/Moscow"
  },
  slot: {
    id: "slot-1",
    label: "Сегодня, 18:00–18:30",
    startsAt: "2026-09-01T15:00:00.000Z",
    endsAt: "2026-09-01T15:30:00.000Z"
  }
};

const order = {
  id: 1,
  status: "pending_payment",
  totalMinor: 90_100,
  currency: "RUB",
  pickup,
  createdAt: "2026-09-01T07:00:00.000Z",
  updatedAt: "2026-09-01T07:00:00.000Z",
  items: [
    {
      productId: 1,
      productName: "Шашлык",
      unitPriceMinor: 45_050,
      quantity: 2,
      lineTotalMinor: 90_100
    }
  ]
};

describe("order contracts", () => {
  it("accepts a client request containing only cart references and pickup selection", () => {
    expect(
      OrderCreateRequestSchema.parse({
        items: [{ productId: 1, quantity: 2 }],
        pickup: { locationId: "main-grill", slotId: "slot-1" }
      })
    ).toEqual({
      items: [{ productId: 1, quantity: 2 }],
      pickup: { locationId: "main-grill", slotId: "slot-1" }
    });
    expect(() =>
      OrderCreateRequestSchema.parse({
        items: [{ productId: 1, quantity: 2 }],
        pickup: { locationId: "main-grill", slotId: "slot-1" },
        totalMinor: 1
      })
    ).toThrow();
  });

  it("validates backend-owned snapshots, totals, status and safe idempotency keys", () => {
    expect(OrderResponseSchema.parse(order)).toEqual(order);
    const summary = Object.fromEntries(
      Object.entries(order).filter(([key]) => key !== "items")
    );
    expect(OrdersListResponseSchema.parse({ orders: [summary] }).orders).toHaveLength(1);
    expect(IdempotencyKeySchema.parse("retry-123")).toBe("retry-123");
    expect(() => IdempotencyKeySchema.parse("\nunsafe")).toThrow();
    expect(() => OrderResponseSchema.parse({ ...order, totalMinor: 1 })).toThrow();
    expect(() => OrderResponseSchema.parse({ ...order, status: "paid" })).toThrow();
  });
});
