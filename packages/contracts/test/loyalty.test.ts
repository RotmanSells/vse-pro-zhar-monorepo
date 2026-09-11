import { describe, expect, it } from "vitest";

import {
  AdminLoyaltyLedgerResponseSchema,
  LoyaltyLedgerEntrySchema,
  LoyaltyLedgerQuerySchema,
  LoyaltyRedemptionRequestSchema,
  LoyaltyRewardsResponseSchema,
  LoyaltyRankProgressSchema,
  LoyaltySummaryResponseSchema,
  LOYALTY_RUBLES_PER_COAL,
  LOYALTY_XP_PER_RUBLE
} from "../src/index.js";

const rank = { code: "spark", name: "Искра", thresholdXp: 0, benefits: [] };
const progress = {
  nextRank: { code: "heat", name: "Жар", thresholdXp: 1_000, benefits: [] },
  xpIntoCurrentRank: 450,
  xpToNextRank: 550,
  progressPercent: 45,
  isMaxRank: false
};

describe("loyalty contracts", () => {
  it("accepts confirmed server-owned summary and rejects client authority fields", () => {
    expect(
      LoyaltySummaryResponseSchema.parse({
        status: "confirmed",
        summary: {
          xp: 450,
          coalBalance: 4,
          rank,
          ...progress,
          version: 1,
          updatedAt: "2026-09-04T10:00:00.000Z"
        }
      })
    ).toBeTruthy();
    expect(() => LoyaltySummaryResponseSchema.parse({
      status: "confirmed",
      summary: {
        xp: 1,
        coalBalance: 1,
        rank,
        ...progress,
        version: 0,
        updatedAt: "2026-09-04T10:00:00.000Z",
        balance: 999
      }
    })).toThrow();
  });

  it("accepts rank progress and rejects invalid bounded values", () => {
    expect(LoyaltyRankProgressSchema.parse(progress)).toEqual(progress);
    expect(() => LoyaltyRankProgressSchema.parse({ ...progress, xpIntoCurrentRank: -1 })).toThrow();
    expect(() => LoyaltyRankProgressSchema.parse({ ...progress, xpToNextRank: -1 })).toThrow();
    expect(() => LoyaltyRankProgressSchema.parse({ ...progress, progressPercent: 101 })).toThrow();
    expect(() => LoyaltyRankProgressSchema.parse({ ...progress, progressPercent: 45.5 })).toThrow();
    expect(() => LoyaltyRankProgressSchema.parse({ ...progress, extra: true })).toThrow();
  });

  it("keeps unavailable state explicit and validates integer ledger deltas", () => {
    expect(LoyaltySummaryResponseSchema.parse({ status: "unavailable", reason: "reconciliation_required" })).toEqual({ status: "unavailable", reason: "reconciliation_required" });
    expect(() => LoyaltyLedgerEntrySchema.parse({
      id: 1,
      entryType: "earned",
      sourceType: "completed_order",
      sourceId: "1",
      sourceOrderId: 1,
      xpDelta: 1.5,
      coalDelta: 0,
      xpBalance: 1,
      coalBalance: 0,
      reason: "Заказ",
      actorType: "system",
      actorId: null,
      createdAt: "2026-09-04T10:00:00.000Z"
    })).toThrow();
    expect(LoyaltyLedgerEntrySchema.parse({
      id: 2,
      entryType: "earned",
      sourceType: "wheel_spin",
      sourceId: "wheel:spin:2",
      sourceOrderId: 7,
      xpDelta: 0,
      coalDelta: 10,
      xpBalance: 10,
      coalBalance: 10,
      reason: "Награда рулетки",
      actorType: "system",
      actorId: null,
      createdAt: "2026-09-04T10:00:00.000Z"
    }).sourceType).toBe("wheel_spin");
    expect(LoyaltyLedgerEntrySchema.parse({
      id: 3,
      entryType: "earned",
      sourceType: "quest_reward",
      sourceId: "quest:first_order:customer:1:v1",
      sourceOrderId: null,
      xpDelta: 100,
      coalDelta: 0,
      xpBalance: 110,
      coalBalance: 10,
      reason: "Награда за квест",
      actorType: "system",
      actorId: null,
      createdAt: "2026-09-04T10:00:00.000Z"
    }).sourceType).toBe("quest_reward");
    expect(LoyaltyLedgerQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(AdminLoyaltyLedgerResponseSchema.safeParse({ status: "unavailable", entries: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false }, rule: { version: 1, xpPerRuble: LOYALTY_XP_PER_RUBLE, rublesPerCoal: LOYALTY_RUBLES_PER_COAL, redemptionEnabled: false, expires: false }, unavailableReason: "reconciliation_required" }).success).toBe(true);
  });

  it("keeps reward target and redemption requests Backend-owned", () => {
    const reward = {
      id: 1,
      code: "discount-300",
      name: "Скидка 300 ₽",
      description: "На следующий pickup-заказ",
      costCoal: 10,
      rewardType: "fixed_discount" as const,
      fulfillmentTarget: { type: "fixed_discount" as const, discountMinor: 30_000 },
      isVisible: true,
      isArchived: false,
      activeFrom: null,
      activeUntil: null,
      sortOrder: 0,
      version: 1,
      perCustomerUsageLimit: 1,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z"
    };
    expect(LoyaltyRewardsResponseSchema.parse({ status: "confirmed", rewards: [reward] }).rewards[0]).toEqual(reward);
    expect(LoyaltyRedemptionRequestSchema.safeParse({ rewardId: 1, costCoal: 1 }).success).toBe(false);
    expect(LoyaltyRewardsResponseSchema.safeParse({ status: "confirmed", rewards: [{ ...reward, fulfillmentTarget: { type: "unknown", discountMinor: 1 } }] }).success).toBe(false);
  });
});
