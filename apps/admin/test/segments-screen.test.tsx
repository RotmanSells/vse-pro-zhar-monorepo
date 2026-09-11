import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminSegmentPreviewResponse, AdminSegmentsResponse } from "@vse-pro-zhar/contracts";
import type { AdminSegmentsClient } from "@vse-pro-zhar/api-client";

import { SegmentsScreen } from "../src/components/segments-screen";

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}

const codes = ["sleeping", "one_timer", "churned", "newbies", "regulars", "vip", "big_spenders", "coal_rich", "at_risk"] as const;
const builtins = codes.map((code, index) => ({ code, kind: "builtin" as const, icon: "🔥", title: code === "regulars" ? "Постоянные" : `Сегмент ${index + 1}`, description: "Подтверждённое условие", badge: { tone: "success" as const, label: "Топ" }, criteria: [{ metric: "orders" as const, operator: "gte" as const, unit: "orders" as const, value: 1 }], count: { status: "confirmed" as const, count: index + 1 } }));
const regulars = builtins.find((segment) => segment.code === "regulars");
if (regulars === undefined) throw new Error("Regulars fixture is missing");
const response: AdminSegmentsResponse = {
  status: "confirmed",
  timezone: "Europe/Moscow",
  asOf: "2026-09-01T10:00:00.000Z",
  builtins,
  customSegments: [],
  customLifecycle: { status: "unavailable", reason: "owner_decision_required" }
};
const preview: AdminSegmentPreviewResponse = {
  status: "confirmed",
  segment: regulars,
  customers: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234", orderCount: 3, spentMinor: 450_000, lastActivityAt: "2026-09-01T08:00:00.000Z" }],
  pagination: { limit: 25, offset: 0, total: 1, hasNext: false },
  dataStatus: "available"
};
const unavailablePreview: AdminSegmentPreviewResponse = {
  status: "unavailable",
  segment: regulars,
  reason: "reconciliation_required",
  customers: [],
  pagination: { limit: 25, offset: 0, total: 0, hasNext: false }
};

describe("Admin segments screen", () => {
  beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

  it("renders server-owned counts, bounded masked preview and unavailable actions", async () => {
    const client: AdminSegmentsClient = { list: async () => response, preview: async () => preview };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<SegmentsScreen client={client} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected segments renderer");
    expect(text(renderer.root)).toContain("Готовые сегменты");
    expect(text(renderer.root)).toContain("Постоянные");
    expect(text(renderer.root)).toContain("5");

    const regularsCard = renderer.root.find((node) => node.props["aria-label"] === "Открыть сегмент «Постоянные»");
    await act(async () => { regularsCard.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
    expect(text(renderer.root)).toContain("Анна");
    expect(text(renderer.root)).toContain("•••• 1234");
    const unavailableAction = renderer.root.findAll((node) => node.props["aria-disabled"] === "true")[0];
    if (unavailableAction === undefined) throw new Error("Expected an unavailable segment action");
    expect(unavailableAction.props.disabled).toBe(true);
    await act(async () => renderer?.unmount());
  });

  it("keeps custom segment creation visibly unavailable behind the prototype modal", async () => {
    const client: AdminSegmentsClient = { list: async () => response, preview: async () => preview };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<SegmentsScreen client={client} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected segments renderer");
    const createButton = renderer.root.find((node) => node.type === "button" && text(node) === "＋ Создать сегмент");
    await act(async () => createButton.props.onClick());
    expect(text(renderer.root)).toContain("Создание пока недоступно");
    expect(renderer.root.findAll((node) => node.props.disabled === true).some((node) => text(node) === "Создать")).toBe(true);
    await act(async () => renderer?.unmount());
  });

  it("does not enable messaging for an unavailable segment preview", async () => {
    const client: AdminSegmentsClient = { list: async () => response, preview: async () => unavailablePreview };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<SegmentsScreen client={client} onOpenCommunications={() => undefined} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected segments renderer");
    const regularsCard = renderer.root.find((node) => node.props["aria-label"] === "Открыть сегмент «Постоянные»");
    await act(async () => { regularsCard.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
    const messageButton = renderer.root.find((node) => text(node) === "✈ Написать сегменту");
    expect(messageButton.props.disabled).toBe(true);
    await act(async () => renderer?.unmount());
  });
});
