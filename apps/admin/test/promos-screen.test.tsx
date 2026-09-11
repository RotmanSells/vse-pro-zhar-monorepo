import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminPromosClient } from "@vse-pro-zhar/api-client";
import type { AdminPromo, AdminPromosResponse } from "@vse-pro-zhar/contracts";

import { PromosScreen } from "../src/components/promos-screen";

function text(node: { children: unknown[] }): string {
  return node.children.map((child) => typeof child === "string" ? child : typeof child === "object" && child !== null && "children" in child ? text(child as { children: unknown[] }) : "").join("");
}

const promo: AdminPromo = { id: 1, code: "FIRE500", description: "Скидка 500 ₽", type: "fixed", value: 50_000, minimumOrderMinor: 200_000, currency: "RUB", activeFrom: "2026-09-01T00:00:00.000Z", activeUntil: null, globalUsageLimit: null, perCustomerUsageLimit: null, stackingPolicy: "none", status: "active", version: 1, usageCount: 0, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const response: AdminPromosResponse = { status: "confirmed", timezone: "Europe/Moscow", currency: "RUB", promos: [promo], pagination: { limit: 50, offset: 0, total: 1, hasNext: false }, customerCheckout: { status: "unavailable", reason: "owner_decision_required" } };

describe("Admin promos screen", () => {
  beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

  it("renders Backend-owned rows, exact prototype headings and unavailable Customer path", async () => {
    const client: AdminPromosClient = { list: async () => response, listRedemptions: async () => ({ status: "confirmed", promoId: 1, promoCode: "FIRE500", redemptions: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }), create: async () => ({ promo }), update: async () => ({ promo }), setActive: async () => ({ promo }), archive: async () => ({ promo }) };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<PromosScreen client={client} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected promos renderer");
    expect(text(renderer.root)).toContain("Промокоды");
    expect(text(renderer.root)).toContain("Создание и управление промокодами");
    expect(text(renderer.root)).toContain("FIRE500");
    expect(text(renderer.root)).toContain("500 ₽");
    expect(text(renderer.root)).toContain("Customer checkout и скидки в заказах пока недоступны");
    const createButton = renderer.root.find((node) => node.type === "button" && text(node) === "＋ Создать промокод");
    await act(async () => createButton.props.onClick());
    expect(text(renderer.root)).toContain("Новый промокод");
    await act(async () => renderer?.unmount());
  });
});
