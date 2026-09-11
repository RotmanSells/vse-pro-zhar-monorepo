import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminLoyaltyClient } from "@vse-pro-zhar/api-client";
import type { AdminQuestsResponse, QuestDefinitionCreateRequest } from "@vse-pro-zhar/contracts";

import { QuestManagement } from "../src/components/loyalty-screen";

const quest = { id: 1, code: "first_order", title: "Первый жар", description: "Сделайте первый заказ", goal: 1, unit: "order" as const, rewardType: "xp" as const, rewardValue: 100, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 2 };
const response: AdminQuestsResponse = { status: "confirmed", quests: [quest] };

function text(node: { children: unknown[] }): string {
  return node.children.map((child) => typeof child === "string" ? child : typeof child === "object" && child !== null && "children" in child ? text(child as { children: unknown[] }) : "").join("");
}

function findByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const node = renderer.root.find((candidate) => candidate.props["aria-label"] === label);
  return node;
}

describe("Admin quest management screen", () => {
  beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

  it("opens the prototype-shaped modal and sends one idempotent create", async () => {
    const createCalls: Array<{ readonly input: QuestDefinitionCreateRequest; readonly key: string | undefined }> = [];
    const client: AdminLoyaltyClient = {
      list: async () => ({ status: "confirmed", entries: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false }, rule: { version: 1, xpPerRuble: 1, rublesPerCoal: 100, redemptionEnabled: false, expires: false } }),
      getWheel: async () => { throw new Error("not used"); },
      updateWheelSettings: async () => { throw new Error("not used"); },
      createWheelPrize: async () => { throw new Error("not used"); },
      updateWheelPrize: async () => { throw new Error("not used"); },
      getQuests: async () => response,
      createQuest: async (input, options) => { createCalls.push({ input, key: options?.idempotencyKey }); return response; },
      updateQuest: async () => response
    };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<QuestManagement client={client} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected quest renderer");
    const add = renderer.root.find((node) => node.type === "button" && text(node) === "＋ Добавить квест");
    await act(async () => add.props.onClick());
    expect(text(renderer.root)).toContain("Новый квест");
    await act(async () => findByLabel(renderer as ReactTestRenderer, "Код").props.onChange({ target: { value: "spring_fire" } }));
    await act(async () => findByLabel(renderer as ReactTestRenderer, "Название").props.onChange({ target: { value: "Весенний жар" } }));
    const form = renderer.root.find((node) => node.type === "form");
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await Promise.resolve(); await Promise.resolve(); });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.input).toMatchObject({ code: "spring_fire", title: "Весенний жар", unit: "order", rewardType: "xp" });
    expect(createCalls[0]?.key).toBeTruthy();
    await act(async () => renderer?.unmount());
  });
});
