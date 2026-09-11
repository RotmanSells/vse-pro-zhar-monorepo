import { describe, expect, it } from "vitest";

import type {
  AdminLoyaltyLedgerListResult,
  LoyaltyAccountAggregate,
  LoyaltyAccountRecord,
  LoyaltyEarnCandidate,
  LoyaltyEarnResult,
  LoyaltyEarnTransactionInput,
  LoyaltyLedgerListResult,
  LoyaltyRepository,
  LoyaltyLedgerRecord,
  OrderRecord,
  PaymentRecord
} from "@vse-pro-zhar/database";

import { LoyaltyProcessor } from "../src/loyalty/processor.js";
import { LoyaltyService, rankForXp, rankProgressForXp } from "../src/loyalty/service.js";

const now = new Date("2026-09-04T10:00:00.000Z");

function order(totalMinor = 150_050): OrderRecord {
  return {
    id: 7,
    customerId: 1,
    pickupLocationId: "main-grill",
    pickupLocationName: "Основная точка",
    pickupLocationAddress: "ул. Жара, 1",
    pickupLocationTimezone: "Europe/Moscow",
    pickupSlotId: "slot-7",
    pickupSlotLabel: "Сегодня, 13:00–13:30",
    pickupSlotStartsAt: now,
    pickupSlotEndsAt: new Date(now.getTime() + 1_800_000),
    status: "completed",
    totalMinor,
    currency: "RUB",
    idempotencyKey: "order-7",
    payloadFingerprint: "a".repeat(64),
    createdAt: now,
    updatedAt: now
  };
}

function payment(): PaymentRecord {
  return {
    id: 8,
    orderId: 7,
    customerId: 1,
    provider: "yookassa",
    providerPaymentId: "yk-7",
    amountMinor: 150_050,
    currency: "RUB",
    status: "succeeded",
    providerStatus: "succeeded",
    confirmationType: null,
    confirmationUrl: null,
    idempotencyKey: "payment-7",
    payloadFingerprint: "b".repeat(64),
    createdAt: now,
    updatedAt: now
  };
}

function fakeRepository(): {
  readonly repository: LoyaltyRepository;
  readonly account: LoyaltyAccountRecord;
  readonly calculations: Array<ReturnType<NonNullable<LoyaltyEarnTransactionInput["calculate"]>>>;
  readonly setCandidate: (candidate: LoyaltyEarnCandidate | null) => void;
  readonly getEarnCalls: () => number;
} {
  const account: LoyaltyAccountRecord = { id: 1, customerId: 1, xp: 0, coalBalance: 0, rankCode: "spark", rankVersion: 1, version: 0, createdAt: now, updatedAt: now };
  const ledger: LoyaltyLedgerRecord = { id: 1, loyaltyAccountId: 1, customerId: 1, entryType: "earned", sourceType: "completed_order", sourceId: "7", sourceOrderId: 7, ruleVersion: 1, idempotencyKey: "loyalty:completed-order:7:v1", xpDelta: 1_500, coalDelta: 15, xpBalance: 1_500, coalBalance: 15, sourceOrderTotalMinor: 150_050, sourceOrderCurrency: "RUB", reason: "Завершённый оплаченный заказ", actorType: "system", actorId: null, createdAt: now };
  const aggregate: LoyaltyAccountAggregate = { account, ledgerXp: 0, ledgerCoal: 0, isConsistent: true };
  let candidate: LoyaltyEarnCandidate | null = { order: order(), payment: payment() };
  let earnCalls = 0;
  let persisted = false;
  const calculations: Array<ReturnType<NonNullable<LoyaltyEarnTransactionInput["calculate"]>>> = [];
  const repository: LoyaltyRepository = {
    async getAccount() { return aggregate; },
    async listCustomerLedger(): Promise<LoyaltyLedgerListResult> { return { entries: [], total: 0, account: aggregate }; },
    async listAdminLedger(): Promise<AdminLoyaltyLedgerListResult> { return { entries: [], total: 0, isConsistent: true }; },
    async claimNextEligibleOrder() { if (persisted) return null; const current = candidate; candidate = null; return current; },
    async earnCompletedOrder(input): Promise<LoyaltyEarnResult> {
      earnCalls += 1;
      if (persisted) return { status: "already_earned", ledger, account, rankChanged: false };
      persisted = true;
      calculations.push(input.calculate({ order: order(), payment: payment(), account }));
      return { status: "earned", ledger, account, rankChanged: true };
    }
  };
  return { repository, account, calculations, setCandidate: (next) => { candidate = next; }, getEarnCalls: () => earnCalls };
}

describe("loyalty formula and processor", () => {
  it("uses integer rubles and coal blocks and applies rank thresholds", async () => {
    expect(rankForXp(0)).toBe("spark");
    expect(rankForXp(999)).toBe("spark");
    expect(rankForXp(1_000)).toBe("heat");
    expect(rankForXp(5_000)).toBe("flame");
    expect(rankForXp(15_000)).toBe("volcano");
    const state = fakeRepository();
    await new LoyaltyService(state.repository).earnCompletedOrder(7);
    expect(state.calculations[0]).toEqual({ xpDelta: 1_500, coalDelta: 15, nextRankCode: "heat", reason: "Завершённый оплаченный заказ" });
  });

  it("continues after restart without a second durable processing", async () => {
    const state = fakeRepository();
    const service = new LoyaltyService(state.repository);
    const first = new LoyaltyProcessor(state.repository, service, { intervalMs: 100 });
    await expect(first.runOnce()).resolves.toBe(1);
    await expect(first.runOnce()).resolves.toBe(0);
    state.setCandidate({ order: order(), payment: payment() });
    const restarted = new LoyaltyProcessor(state.repository, service, { intervalMs: 100 });
    await expect(restarted.runOnce()).resolves.toBe(0);
    expect(state.getEarnCalls()).toBe(1);
    await first.stop();
    await restarted.stop();
  });
});

describe("loyalty rank progress", () => {
  it.each([
    [0, "heat", 0, 1_000, 0, false],
    [999, "heat", 999, 1, 99, false],
    [1_000, "flame", 0, 4_000, 0, false],
    [4_999, "flame", 3_999, 1, 99, false],
    [5_000, "volcano", 0, 10_000, 0, false],
    [14_999, "volcano", 9_999, 1, 99, false],
    [15_000, null, 0, 0, 100, true]
  ])(
    "projects %s XP into the approved rank ladder",
    (xp, nextRankCode, xpIntoCurrentRank, xpToNextRank, progressPercent, isMaxRank) => {
      const projection = rankProgressForXp(xp);
      expect(projection).toMatchObject({
        nextRank: nextRankCode === null ? null : { code: nextRankCode },
        xpIntoCurrentRank,
        xpToNextRank,
        progressPercent,
        isMaxRank
      });
    }
  );
});
