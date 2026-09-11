import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminLoyaltyClient } from "@vse-pro-zhar/api-client";
import type { AdminWheelResponse, WheelSettingsUpdateRequest } from "@vse-pro-zhar/contracts";

import { LoyaltyScreen } from "../src/components/loyalty-screen";

const response: AdminWheelResponse = {
  status: "confirmed",
  settings: { id: 1, enabled: true, eligibility: "completed_paid_order", minOrderAmountMinor: 150_000, currency: "RUB", cooldownSeconds: 86_400, maxSpins: 1, limitPeriodSeconds: 86_400, activeFrom: null, activeUntil: null, version: 1, updatedAt: "2026-09-01T00:00:00.000Z" },
  prizes: [{ id: 1, code: "no_prize", name: "Искра рядом", description: "", type: "no_prize", value: 0, weight: 100, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1 }]
};

function text(node: { children: unknown[] }): string {
  return node.children.map((child) => typeof child === "string" ? child : typeof child === "object" && child !== null && "children" in child ? text(child as { children: unknown[] }) : "").join("");
}

function findByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find((candidate) => candidate.props["aria-label"] === label);
}

describe("Admin wheel settings screen", () => {
  beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

  it("renders the read-only eligibility and sends the complete settings snapshot", async () => {
    const updates: Array<{ readonly input: WheelSettingsUpdateRequest; readonly key: string | undefined }> = [];
    const client: AdminLoyaltyClient = {
      list: async () => ({ status: "confirmed", entries: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false }, rule: { version: 1, xpPerRuble: 1, rublesPerCoal: 100, redemptionEnabled: false, expires: false } }),
      getWheel: async () => response,
      updateWheelSettings: async (input, options) => { updates.push({ input, key: options?.idempotencyKey }); return { ...response, settings: { ...response.settings, ...input, version: 2, updatedAt: "2026-09-01T00:01:00.000Z", activeFrom: input.activeFrom ?? null, activeUntil: input.activeUntil ?? null } }; },
      createWheelPrize: async () => response,
      updateWheelPrize: async () => response,
      getQuests: async () => ({ status: "confirmed", quests: [] }),
      createQuest: async () => ({ status: "confirmed", quests: [] }),
      updateQuest: async () => ({ status: "confirmed", quests: [] })
    };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<LoyaltyScreen client={client} section="wheel" />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected wheel renderer");
    expect(text(renderer.root)).toContain("Завершённый оплаченный заказ");
    await act(async () => findByLabel(renderer as ReactTestRenderer, "Минимальная сумма заказа").props.onChange({ target: { value: "2000" } }));
    await act(async () => findByLabel(renderer as ReactTestRenderer, "Cooldown").props.onChange({ target: { value: "3600" } }));
    await act(async () => findByLabel(renderer as ReactTestRenderer, "Лимит вращений").props.onChange({ target: { value: "2" } }));
    await act(async () => findByLabel(renderer as ReactTestRenderer, "Период лимита").props.onChange({ target: { value: "172800" } }));
    const form = renderer.root.find((node) => node.type === "form" && node.findAll((child) => child.type === "button" && text(child) === "Сохранить настройки").length === 1);
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await Promise.resolve(); await Promise.resolve(); });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.input).toMatchObject({ expectedVersion: 1, minOrderAmountMinor: 200_000, cooldownSeconds: 3_600, maxSpins: 2, limitPeriodSeconds: 172_800, activeFrom: null, activeUntil: null });
    expect(updates[0]?.key).toBeTruthy();
    await act(async () => renderer?.unmount());
  });
});
