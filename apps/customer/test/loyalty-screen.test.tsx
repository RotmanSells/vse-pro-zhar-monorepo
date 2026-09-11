import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  LoyaltyClientError,
  type LoyaltyClient
} from "@vse-pro-zhar/api-client";
import type {
  CustomerProfile,
  LoyaltyLedgerResponse,
  LoyaltyRedemptionResponse,
  LoyaltyRewardsResponse,
  LoyaltySummary,
  LoyaltySummaryResponse
} from "@vse-pro-zhar/contracts";

import { LoyaltyScreen } from "../src/components/loyalty-screen";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View"
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));

const customer: CustomerProfile = {
  phone: "+79991234567",
  name: "Анна",
  birthDate: null
};

const ledger: LoyaltyLedgerResponse = {
  status: "confirmed",
  entries: [{ id: 1, entryType: "earned", sourceType: "wheel_spin", sourceId: "wheel:spin:1", sourceOrderId: 7, xpDelta: 0, coalDelta: 10, xpBalance: 10, coalBalance: 10, reason: "Награда рулетки", actorType: "system", actorId: null, createdAt: "2026-09-04T10:00:00.000Z" }],
  pagination: { limit: 50, offset: 0, total: 0, hasNext: false }
};

function summary(overrides: Partial<LoyaltySummary> = {}): LoyaltySummary {
  return {
    xp: 450,
    coalBalance: 4,
    rank: { code: "spark", name: "Искра", thresholdXp: 0, benefits: [] },
    nextRank: { code: "heat", name: "Жар", thresholdXp: 1_000, benefits: [] },
    xpIntoCurrentRank: 450,
    xpToNextRank: 550,
    progressPercent: 45,
    isMaxRank: false,
    version: 1,
    updatedAt: "2026-09-04T10:00:00.000Z",
    ...overrides
  };
}

function text(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
}

function hasText(renderer: ReactTestRenderer, value: string): boolean {
  return renderer.root.findAll((node) => text(node).includes(value)).length > 0;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function clientFor(getSummary: LoyaltyClient["getSummary"]): LoyaltyClient {
  return {
    getSummary,
    getLedger: async () => ledger
  };
}

async function render(client: LoyaltyClient): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(<LoyaltyScreen client={client} customer={customer} onBack={() => undefined} />);
    await flush();
  });
  if (renderer === null) throw new Error("Renderer was not created");
  return renderer;
}

describe("Customer Passport loyalty screen", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  it("keeps the Passport card in loading state until confirmed summary arrives", async () => {
    const pending = new Promise<LoyaltySummaryResponse>(() => undefined);
    const renderer = await render(clientFor(async () => pending));

    expect(hasText(renderer, "Загружаем баланс…")).toBe(true);
    expect(hasText(renderer, "Паспорт Жара")).toBe(false);
  });

  it("renders only Backend-confirmed progress and exposes no client controls", async () => {
    const renderer = await render(clientFor(async () => ({ status: "confirmed", summary: summary() })));

    expect(hasText(renderer, "Искра")).toBe(true);
    expect(hasText(renderer, "До ранга «Жар» осталось 550 XP")).toBe(true);
    expect(hasText(renderer, "450")).toBe(true);
    expect(hasText(renderer, "История операций")).toBe(true);
    expect(hasText(renderer, "Награда рулетки")).toBe(true);
    expect(renderer.root.findAll((node) => String(node.type) === "TextInput")).toHaveLength(0);

    const progress = renderer.root.find((node) => node.props["testID"] === "loyalty-progress");
    expect(progress.props["accessibilityValue"]).toEqual({ max: 100, min: 0, now: 45 });
  });

  it("renders max rank without inventing a next rank", async () => {
    const renderer = await render(clientFor(async () => ({
      status: "confirmed",
      summary: summary({
        xp: 15_000,
        coalBalance: 150,
        rank: { code: "volcano", name: "Вулкан", thresholdXp: 15_000, benefits: [] },
        nextRank: null,
        xpIntoCurrentRank: 0,
        xpToNextRank: 0,
        progressPercent: 100,
        isMaxRank: true
      })
    })));

    expect(hasText(renderer, "Вулкан")).toBe(true);
    expect(hasText(renderer, "Максимальный ранг достигнут")).toBe(true);
    expect(hasText(renderer, "До ранга")).toBe(false);
    expect(renderer.root.find((node) => node.props["testID"] === "passport-rank-icon")).toBeTruthy();
  });

  it("does not show successful progress for unavailable or failed summary", async () => {
    const unavailable = await render(clientFor(async () => ({ status: "unavailable", reason: "reconciliation_required" })));
    expect(hasText(unavailable, "Баланс временно недоступен")).toBe(true);
    expect(hasText(unavailable, "Паспорт Жара")).toBe(false);

    const failed = await render(clientFor(async () => {
      throw new LoyaltyClientError("network", "Не удалось связаться с Backend API");
    }));
    expect(hasText(failed, "Не удалось загрузить баланс")).toBe(true);
    expect(hasText(failed, "Паспорт Жара")).toBe(false);
  });

  it("retries redemption with the same idempotency key and shows the failure state", async () => {
    const rewards: LoyaltyRewardsResponse = { status: "confirmed", rewards: [{ id: 1, code: "discount", name: "Скидка", description: "На следующий заказ", costCoal: 1, rewardType: "fixed_discount", fulfillmentTarget: { type: "fixed_discount", discountMinor: 100 }, isVisible: true, isArchived: false, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1, perCustomerUsageLimit: 1, createdAt: "2026-09-04T10:00:00.000Z", updatedAt: "2026-09-04T10:00:00.000Z" }] };
    const redemption: LoyaltyRedemptionResponse = { status: "confirmed", redemption: { id: 1, rewardId: 1, rewardCode: "discount", rewardName: "Скидка", costCoal: 1, rewardType: "fixed_discount", discountMinor: 100, expiresAt: "2026-10-04T10:00:00.000Z", status: "pending", createdAt: "2026-09-04T10:00:00.000Z", updatedAt: "2026-09-04T10:00:00.000Z" }, coalBalance: 3 };
    const redeem = vi.fn<(rewardId: number, idempotencyKey: string) => Promise<LoyaltyRedemptionResponse>>()
      .mockRejectedValueOnce(new LoyaltyClientError("timeout", "Backend API не ответил вовремя"))
      .mockResolvedValue(redemption);
    const client: LoyaltyClient = { getSummary: async () => ({ status: "confirmed", summary: summary() }), getLedger: async () => ledger, getRewards: async () => rewards, getRedemptions: async () => ({ status: "confirmed", redemptions: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }), redeem };
    const renderer = await render(client);
    const rewardButton = renderer.root.find((node) => node.props["accessibilityLabel"] === "Обменять угольки на Скидка");
    await act(async () => rewardButton.props["onPress"]());
    const confirmButton = renderer.root.find((node) => text(node) === "Подтвердить");
    await act(async () => { confirmButton.props["onPress"](); await flush(); });
    expect(hasText(renderer, "Списание требует проверки")).toBe(true);
    const retryButton = renderer.root.find((node) => text(node) === "Повторить списание");
    await act(async () => { retryButton.props["onPress"](); await flush(); });
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(redeem.mock.calls[0]?.[1]).toBe(redeem.mock.calls[1]?.[1]);
    await act(async () => renderer.unmount());
  });
});
