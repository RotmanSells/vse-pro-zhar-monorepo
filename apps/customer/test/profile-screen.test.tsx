import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ProfileClient } from "@vse-pro-zhar/api-client";
import type { CustomerProfileResponse } from "@vse-pro-zhar/contracts";

import { ProfileScreen } from "../src/components/profile-screen";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View"
}));

const profile: CustomerProfileResponse = {
  customer: { phone: "+79991234567", name: "Анна", birthDate: null },
  stats: {
    orderCount: 2,
    favoriteProduct: "Шашлык из свинины",
    nextMilestone: { label: "До ранга «Жар»", remaining: 550, unit: "xp", source: "loyalty_rank" }
  },
  loyalty: {
    status: "confirmed",
    summary: {
      xp: 450,
      coalBalance: 4,
      rank: { code: "spark", name: "Искра", thresholdXp: 0, benefits: [] },
      nextRank: { code: "heat", name: "Жар", thresholdXp: 1000, benefits: [] },
      xpIntoCurrentRank: 450,
      xpToNextRank: 550,
      progressPercent: 45,
      isMaxRank: false,
      version: 1,
      updatedAt: "2026-09-04T10:00:00.000Z"
    }
  },
  settings: {
    pushNotifications: { status: "unavailable", reason: "native_push_contract_pending" },
    emailSubscription: { status: "unavailable", reason: "email_consent_contract_pending" },
    darkTheme: { status: "unavailable", reason: "theme_contract_pending" }
  },
  recentOrders: [{
    id: 11,
    status: "completed",
    totalMinor: 45_050,
    currency: "RUB",
    pickup: {
      location: { id: "main-grill", name: "Основная точка", address: "ул. Бабушкина, 181", timezone: "Europe/Moscow" },
      slot: { id: "slot-1", label: "Сегодня, 18:00–18:30", startsAt: "2026-09-04T15:00:00.000Z", endsAt: "2026-09-04T15:30:00.000Z" }
    },
    createdAt: "2026-09-04T10:00:00.000Z",
    updatedAt: "2026-09-04T10:00:00.000Z",
    items: [{ productId: 3, productName: "Шашлык из свинины", unitPriceMinor: 45_050, quantity: 1, lineTotalMinor: 45_050 }]
  }]
};

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAll((node) => node.props["accessibilityLabel"] === label)[0];
  if (found === undefined) throw new Error(`Missing button ${label}`);
  return found;
}

describe("Customer Profile screen", () => {
  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

  it("renders confirmed data, truthful settings and expandable production rules", async () => {
    const client: ProfileClient = { getProfile: vi.fn(async () => profile) };
    const onOpenOrders = vi.fn();
    const onTabSelect = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(<ProfileScreen cartItemCount={0} client={client} customer={profile.customer} onBack={vi.fn()} onLogout={vi.fn(async () => undefined)} onOpenOrders={onOpenOrders} onTabSelect={onTabSelect} />);
      await flush();
    });
    if (renderer === null) throw new Error("Renderer was not created");
    const mountedRenderer = renderer as ReactTestRenderer;
    expect(text(mountedRenderer.root.findByProps({ testID: "profile-head" }))).toContain("Анна");
    expect(text(mountedRenderer.root.findByProps({ testID: "profile-stats" }))).toContain("Шашлык из свинины");
    expect(text(mountedRenderer.root.findByProps({ testID: "profile-history-card" }))).toContain("450,50₽");
    expect(mountedRenderer.root.findAllByProps({ testID: "profile-history-empty" })).toHaveLength(0);
    expect(mountedRenderer.root.findAllByProps({ testID: "profile-bonus-body" })).toHaveLength(0);

    await act(async () => {
      button(mountedRenderer, "Как работает бонусная система").props["onPress"]();
      await flush();
    });
    expect(text(mountedRenderer.root.findByProps({ testID: "profile-bonus-body" }))).toContain("100 ₽");
    expect(text(mountedRenderer.root.findByProps({ testID: "profile-settings" }))).toContain("Недоступно");
    button(mountedRenderer, "Открыть мой Паспорт").props["onPress"]();
    button(mountedRenderer, "Открыть все заказы").props["onPress"]();
    expect(onTabSelect).toHaveBeenCalledWith("passport");
    expect(onOpenOrders).toHaveBeenCalledTimes(1);
  });

  it("shows retryable error and keeps logout failure visible", async () => {
    let rejectProfile: ((error: unknown) => void) | undefined;
    const client: ProfileClient = { getProfile: async () => new Promise((_resolve, reject) => { rejectProfile = reject; }) };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(<ProfileScreen cartItemCount={0} client={client} customer={profile.customer} onBack={vi.fn()} onLogout={vi.fn(async () => { throw new Error("logout failed"); })} onOpenOrders={vi.fn()} onTabSelect={vi.fn()} />);
      await flush();
    });
    if (renderer === null) throw new Error("Renderer was not created");
    const mountedRenderer = renderer as ReactTestRenderer;
    rejectProfile?.(new Error("network"));
    await act(async () => { await flush(); });
    expect(mountedRenderer.root.findByProps({ testID: "profile-error" })).toBeDefined();
  });

  it("keeps a failed server logout actionable", async () => {
    const client: ProfileClient = { getProfile: vi.fn(async () => profile) };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(<ProfileScreen cartItemCount={0} client={client} customer={profile.customer} onBack={vi.fn()} onLogout={vi.fn(async () => { throw new Error("logout failed"); })} onOpenOrders={vi.fn()} onTabSelect={vi.fn()} />);
      await flush();
    });
    if (renderer === null) throw new Error("Renderer was not created");
    const mountedRenderer = renderer as ReactTestRenderer;
    await act(async () => {
      button(mountedRenderer, "Выйти из аккаунта").props["onPress"]();
      await flush();
    });
    expect(text(mountedRenderer.root.find((node) => node.props["accessibilityRole"] === "alert"))).toContain("Не удалось завершить сессию");
  });
});
