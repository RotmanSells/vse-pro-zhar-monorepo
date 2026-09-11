import { describe, expect, it } from "vitest";

import {
  QuestDefinitionSchema,
  QuestDefinitionCreateRequestSchema,
  QuestDefinitionUpdateRequestSchema,
  QuestStateResponseSchema,
  WheelPrizeCreateRequestSchema,
  WheelPrizeUpdateRequestSchema,
  WheelPrizeSchema,
  WheelSettingsSchema,
  WheelSettingsUpdateRequestSchema,
  WheelSpinRequestSchema,
  WheelStateResponseSchema
} from "../src/index.js";

describe("M14 wheel and quest contracts", () => {
  it("accepts only bounded server-owned wheel requests and approved prize types", () => {
    expect(WheelSpinRequestSchema.parse({ orderId: 7 })).toEqual({ orderId: 7 });
    expect(WheelPrizeSchema.parse({ id: 1, code: "coal_10", name: "+10", description: "", type: "coal", value: 10, weight: 25, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 1, version: 1 }).weight).toBe(25);
    expect(WheelPrizeCreateRequestSchema.parse({ code: "coal_50", name: "+50", description: "", type: "coal", value: 50, weight: 5, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 4 }).code).toBe("coal_50");
    expect(WheelPrizeUpdateRequestSchema.parse({ expectedVersion: 1, type: "xp", value: 111, weight: 20 })).toMatchObject({ expectedVersion: 1, type: "xp", value: 111 });
    expect(() => WheelSpinRequestSchema.parse({ orderId: 7, rewardValue: 999 })).toThrow();
    expect(() => WheelSpinRequestSchema.parse({ orderId: 1.5 })).toThrow();
    expect(() => WheelPrizeSchema.parse({ id: 1, code: "promo", name: "Promo", description: "", type: "promo", value: 10, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1 })).toThrow();
    expect(() => WheelPrizeSchema.parse({ id: 1, code: "no_prize", name: "No prize", description: "", type: "no_prize", value: 1, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1 })).toThrow();
  });

  it("keeps unavailable wheel/quest states explicit and rejects fake progress", () => {
    expect(WheelStateResponseSchema.parse({ status: "unavailable", reason: "reconciliation_required" })).toEqual({ status: "unavailable", reason: "reconciliation_required" });
    expect(QuestStateResponseSchema.parse({ status: "unavailable", reason: "not_configured" })).toEqual({ status: "unavailable", reason: "not_configured" });
    const definition = { id: 1, code: "first_order", title: "Первый жар", description: "", goal: 1, unit: "order" as const, rewardType: "xp" as const, rewardValue: 100, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1 };
    expect(QuestDefinitionSchema.parse(definition)).toEqual(definition);
    expect(() => QuestDefinitionSchema.parse({ ...definition, goal: 1.5 })).toThrow();
  });

  it("accepts only the approved quest definition mutation model", () => {
    expect(QuestDefinitionCreateRequestSchema.parse({ code: "spring_fire", title: "Весенний жар", goal: 3, unit: "order", rewardType: "coal", rewardValue: 20 })).toMatchObject({ description: "", isVisible: true, sortOrder: 0, activeFrom: null, activeUntil: null });
    expect(QuestDefinitionUpdateRequestSchema.parse({ expectedVersion: 2, title: "Обновлённый квест", isVisible: false })).toMatchObject({ expectedVersion: 2, isVisible: false });
    expect(() => QuestDefinitionCreateRequestSchema.parse({ code: "Spring", title: "Квест", goal: 1, unit: "order", rewardType: "xp", rewardValue: 10 })).toThrow();
    expect(() => QuestDefinitionCreateRequestSchema.parse({ code: "valid", title: "Квест", goal: 1.5, unit: "order", rewardType: "xp", rewardValue: 10 })).toThrow();
    expect(() => QuestDefinitionCreateRequestSchema.parse({ code: "valid", title: "Квест", goal: 1, unit: "minor_units", rewardType: "promo", rewardValue: 10 })).toThrow();
    expect(() => QuestDefinitionUpdateRequestSchema.parse({ expectedVersion: 1, code: "renamed" })).toThrow();
  });

  it("validates editable wheel settings without exposing eligibility or currency controls", () => {
    const update = WheelSettingsUpdateRequestSchema.parse({ expectedVersion: 1, enabled: false, minOrderAmountMinor: 150_000, cooldownSeconds: 3_600, maxSpins: 2, limitPeriodSeconds: 86_400, activeFrom: null, activeUntil: null });
    expect(update).toMatchObject({ expectedVersion: 1, cooldownSeconds: 3_600, maxSpins: 2 });
    expect(WheelSettingsSchema.parse({ id: 1, enabled: true, eligibility: "completed_paid_order", minOrderAmountMinor: 0, currency: "RUB", cooldownSeconds: 1, maxSpins: 1, limitPeriodSeconds: 1, activeFrom: null, activeUntil: null, version: 1, updatedAt: "2026-09-01T00:00:00.000Z" }).minOrderAmountMinor).toBe(0);
    expect(() => WheelSettingsUpdateRequestSchema.parse({ expectedVersion: 1, currency: "USD" })).toThrow();
    expect(() => WheelSettingsUpdateRequestSchema.parse({ expectedVersion: 1, eligibility: "always" })).toThrow();
    expect(() => WheelSettingsUpdateRequestSchema.parse({ expectedVersion: 1, cooldownSeconds: 0 })).toThrow();
    expect(() => WheelSettingsUpdateRequestSchema.parse({ expectedVersion: 1, maxSpins: 1.5 })).toThrow();
    expect(() => WheelSettingsUpdateRequestSchema.parse({ expectedVersion: 1, activeFrom: "2026-09-02T00:00:00.000Z", activeUntil: "2026-09-01T00:00:00.000Z" })).toThrow();
  });
});
