import { describe, expect, it } from "vitest";

import { isWheelOrderEligible, questProgressAfterOrder, selectWeightedPrize, type WheelPrizeRecord } from "@vse-pro-zhar/database";

describe("M14 wheel and quest domain boundaries", () => {
  const paidCompleted = { status: "succeeded", providerStatus: "succeeded", amountMinor: 150_000, currency: "RUB" };
  it("requires completed paid RUB order at the exact minimum", () => {
    expect(isWheelOrderEligible({ status: "completed", totalMinor: 149_999, currency: "RUB" }, { ...paidCompleted, amountMinor: 149_999 })).toBe(false);
    expect(isWheelOrderEligible({ status: "completed", totalMinor: 150_000, currency: "RUB" }, paidCompleted)).toBe(true);
    expect(isWheelOrderEligible({ status: "payment_confirmed", totalMinor: 150_000, currency: "RUB" }, paidCompleted)).toBe(false);
    expect(isWheelOrderEligible({ status: "completed", totalMinor: 150_000, currency: "USD" }, paidCompleted)).toBe(false);
    expect(isWheelOrderEligible({ status: "completed", totalMinor: 150_000, currency: "RUB" }, { ...paidCompleted, amountMinor: 149_999 })).toBe(false);
    expect(isWheelOrderEligible({ status: "completed", totalMinor: 150_000, currency: "RUB" }, paidCompleted, 200_000)).toBe(false);
    expect(isWheelOrderEligible({ status: "completed", totalMinor: 200_000, currency: "RUB" }, { ...paidCompleted, amountMinor: 200_000 }, 200_000)).toBe(true);
  });

  it("caps authoritative progress with integer minor units", () => {
    expect(questProgressAfterOrder("order", 0, 1, 150_000)).toBe(1);
    expect(questProgressAfterOrder("order", 2, 3, 150_000)).toBe(3);
    expect(questProgressAfterOrder("minor_units", 299_999, 300_000, 150_000)).toBe(300_000);
    expect(questProgressAfterOrder("minor_units", 0, 300_000, 150_000)).toBe(150_000);
    expect(() => questProgressAfterOrder("minor_units", 0.5, 300_000, 150_000)).toThrow();
    expect(() => questProgressAfterOrder("order", -1, 1, 150_000)).toThrow();
  });

  it("selects weighted prizes only on the server-owned catalog", () => {
    const prizes = [
      { id: 1, code: "no_prize", prizeType: "no_prize", value: 0, weight: 50, sortOrder: 0 },
      { id: 2, code: "coal_10", prizeType: "coal", value: 10, weight: 25, sortOrder: 1 },
      { id: 3, code: "coal_25", prizeType: "coal", value: 25, weight: 15, sortOrder: 2 },
      { id: 4, code: "xp_100", prizeType: "xp", value: 100, weight: 10, sortOrder: 3 },
      { id: 5, code: "unknown", prizeType: "promo", value: 999, weight: 100, sortOrder: 4 }
    ] as unknown as WheelPrizeRecord[];
    expect(selectWeightedPrize(prizes, () => 0)?.code).toBe("no_prize");
    expect(selectWeightedPrize(prizes, () => 0.5)?.code).toBe("coal_10");
    expect(selectWeightedPrize(prizes, () => 0.75)?.code).toBe("coal_25");
    expect(selectWeightedPrize(prizes, () => 0.9)?.code).toBe("xp_100");
    expect(selectWeightedPrize(prizes.map((prize) => ({ ...prize, weight: 0 })), () => 0.1)).toBeNull();
  });
});
