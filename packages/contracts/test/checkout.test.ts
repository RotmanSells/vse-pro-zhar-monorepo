import { describe, expect, it } from "vitest";

import {
  CheckoutOptionsResponseSchema,
  CheckoutQuoteRequestSchema,
  CheckoutQuoteResponseSchema,
  OperationalAvailabilityRecordSchema
} from "../src/checkout.js";

const slot = {
  id: "main-grill-2026-09-01-1800",
  label: "Сегодня, 18:00–18:30",
  startsAt: "2026-09-01T15:00:00.000Z",
  endsAt: "2026-09-01T15:30:00.000Z"
};

describe("checkout contracts", () => {
  it("accepts server-owned pickup options and reference-only quote input", () => {
    expect(
      CheckoutOptionsResponseSchema.safeParse({
        locations: [
          {
            id: "main-grill",
            name: "Основная точка",
            address: "Основная точка самовывоза",
            timezone: "Europe/Moscow",
            slots: [slot]
          }
        ]
      }).success
    ).toBe(true);

    expect(
      CheckoutQuoteRequestSchema.safeParse({
        items: [{ productId: 1, quantity: 2 }],
        pickup: { locationId: "main-grill", slotId: slot.id }
      }).success
    ).toBe(true);
  });

  it("rejects client money, unknown fields, empty cart and invalid pickup", () => {
    const invalidInputs: unknown[] = [
      { items: [], pickup: { locationId: "main-grill", slotId: slot.id } },
      {
        items: [{ productId: 1, quantity: 1, unitPriceMinor: 1 }],
        pickup: { locationId: "main-grill", slotId: slot.id }
      },
      {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: "hidden location", slotId: slot.id }
      },
      {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: "main-grill", slotId: slot.id },
        totalMinor: 1
      }
    ];

    for (const input of invalidInputs) {
      expect(CheckoutQuoteRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates response snapshots and integer totals", () => {
    const valid = {
      customer: {
        phone: "+79991234567",
        name: "Анна",
        birthDate: null
      },
      items: [
        {
          productId: 1,
          productName: "Шашлык",
          quantity: 2,
          unitPriceMinor: 45_050,
          lineTotalMinor: 90_100
        }
      ],
      totalMinor: 90_100,
      pickup: {
        location: {
          id: "main-grill",
          name: "Основная точка",
          address: "Основная точка самовывоза",
          timezone: "Europe/Moscow"
        },
        slot
      },
      confirmationText: "Проверка завершена. Заказ ещё не создан."
    };

    expect(CheckoutQuoteResponseSchema.safeParse(valid).success).toBe(true);
    expect(
      CheckoutQuoteResponseSchema.safeParse({
        ...valid,
        items: [{ ...valid.items[0], lineTotalMinor: 1 }]
      }).success
    ).toBe(false);
    expect(
      CheckoutQuoteResponseSchema.safeParse({ ...valid, totalMinor: 90_101 }).success
    ).toBe(false);
  });

  it("requires a mapping and a known operational status for availability", () => {
    expect(
      OperationalAvailabilityRecordSchema.safeParse({
        productId: 1,
        iikoProductId: "iiko-1",
        status: "available",
        checkedAt: "2026-09-01T10:00:00.000Z"
      }).success
    ).toBe(true);
    expect(
      OperationalAvailabilityRecordSchema.safeParse({
        productId: 1,
        iikoProductId: null,
        status: "available",
        checkedAt: "2026-09-01T10:00:00.000Z"
      }).success
    ).toBe(false);
  });
});
