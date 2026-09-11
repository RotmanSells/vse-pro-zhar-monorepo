import { describe, expect, it } from "vitest";

import {
  AuthStateSchema,
  CustomerIdentifyRequestSchema,
  CustomerIdentifyResponseSchema,
  PendingAddActionSchema
} from "../src/auth.js";

describe("customer authentication contracts", () => {
  it("accepts the identification payload and server response", () => {
    expect(
      CustomerIdentifyRequestSchema.parse({
        phone: " 8 (999) 123-45-67 ",
        name: "  Анна  ",
        birthDate: "1990-02-28"
      })
    ).toMatchObject({ phone: "8 (999) 123-45-67", name: "Анна" });

    expect(
      CustomerIdentifyResponseSchema.parse({
        customer: {
          phone: "+79991234567",
          name: "Анна",
          birthDate: "1990-02-28"
        },
        session: {
          token: "a".repeat(43),
          expiresAt: "2026-09-01T10:00:00.000Z"
        }
      })
    ).toBeTruthy();
  });

  it("rejects unknown fields and invalid birth dates", () => {
    expect(() =>
      CustomerIdentifyRequestSchema.parse({ phone: "+79991234567" })
    ).toThrow();
    expect(() =>
      CustomerIdentifyRequestSchema.parse({
        phone: "+79991234567",
        name: "Анна",
        staffRole: "admin"
      })
    ).toThrow();
    expect(() =>
      CustomerIdentifyRequestSchema.parse({
        phone: "+79991234567",
        name: "Анна",
        birthDate: "2026-02-30"
      })
    ).toThrow();
    expect(() =>
      CustomerIdentifyRequestSchema.parse({
        phone: "+79991234567",
        name: "Анна",
        birthDate: "2999-01-01"
      })
    ).toThrow();
  });

  it("keeps add-gate actions free of profile data", () => {
    expect(PendingAddActionSchema.parse({ productId: 7, quantity: 2 })).toEqual({
      productId: 7,
      quantity: 2
    });
    expect(() =>
      PendingAddActionSchema.parse({
        productId: 7,
        quantity: 2,
        phone: "+79991234567"
      })
    ).toThrow();
    expect(AuthStateSchema.parse({ status: "anonymous" })).toEqual({
      status: "anonymous"
    });
  });
});
