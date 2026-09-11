import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminCommunicationPreviewResponse, AdminCommunicationsResponse } from "@vse-pro-zhar/contracts";
import type { AdminCommunicationsClient } from "@vse-pro-zhar/api-client";

import { CommunicationsScreen } from "../src/components/communications-screen";

function nodeText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : nodeText(child)).join("");
}

function text(renderer: ReactTestRenderer): string {
  return nodeText(renderer.root);
}

const response: AdminCommunicationsResponse = {
  status: "confirmed",
  timezone: "Europe/Moscow",
  templates: ["promo", "winback", "thankyou", "birthday", "newdish", "coal"].map((code, index) => ({ code, version: 1, icon: "🔥", title: ["Промо-акция", "Вернуть клиента", "Благодарность", "День рождения", "Новинка в меню", "Напоминание об угольках"][index] ?? code, body: "🔥 {name}", variables: ["name"] })),
  promoOptions: [],
  channels: [
    { channel: "push", status: "unavailable", reason: "provider_not_connected" },
    { channel: "sms", status: "unavailable", reason: "provider_not_connected" }
  ],
  draft: { status: "available", reason: "postgres_persistence" },
  dispatch: { status: "unavailable", reason: "owner_decision_required" },
  export: { status: "unavailable", reason: "owner_decision_required" },
  history: { status: "confirmed", message: "Нет истории", drafts: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }
};
const preview: AdminCommunicationPreviewResponse = {
  status: "confirmed",
  segmentCode: "regulars",
  templateCode: "promo",
  channel: "push",
  recipientCount: 2,
  generatedAt: "2026-09-01T10:00:00.000Z",
  segmentAsOf: "2026-09-01T10:00:00.000Z",
  renderedBody: "🔥 Анна",
  recipientsPreview: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234" }]
};

describe("Admin communications screen", () => {
  beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

  it("renders server-owned empty history and the prototype message modal with truthful unavailable actions", async () => {
    const client: AdminCommunicationsClient = { get: async () => response, listDrafts: async () => ({ status: "confirmed", drafts: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }), getDraft: async () => ({ status: "confirmed", draft: {} as never, audit: [] }), createDraft: async () => ({ draft: {} as never }), updateDraft: async () => ({ draft: {} as never }), archiveDraft: async () => ({ draft: {} as never }), restoreDraft: async () => ({ draft: {} as never }), preview: async () => preview };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<CommunicationsScreen client={client} initialSegmentCode="regulars" />); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected communications renderer");
    expect(text(renderer)).toContain("История рассылок");
    expect(text(renderer)).toContain("Сохранённых черновиков пока нет");
    expect(text(renderer)).toContain("Промо-акция");
    expect(text(renderer)).toContain("Отправка недоступна до подключения Push/SMS");
    const send = renderer.root.find((node) => node.type === "button" && nodeText(node).includes("Отправить"));
    expect(send.props.disabled).toBe(true);
    expect(renderer.root.findAll((node) => node.type === "button" && nodeText(node).includes("Экспорт")).some((node) => node.props.disabled === true)).toBe(true);
    await act(async () => renderer?.unmount());
  });

  it("keeps direct navigation truthful until a segment is selected", async () => {
    const client: AdminCommunicationsClient = { get: async () => response, listDrafts: async () => ({ status: "confirmed", drafts: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }), getDraft: async () => ({ status: "confirmed", draft: {} as never, audit: [] }), createDraft: async () => ({ draft: {} as never }), updateDraft: async () => ({ draft: {} as never }), archiveDraft: async () => ({ draft: {} as never }), restoreDraft: async () => ({ draft: {} as never }), preview: async () => preview };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<CommunicationsScreen client={client} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected communications renderer");
    expect(text(renderer)).toContain("Выберите сегмент для preview");
    await act(async () => renderer?.unmount());
  });
});
