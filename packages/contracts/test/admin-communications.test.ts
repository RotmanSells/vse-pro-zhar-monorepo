import { describe, expect, it } from "vitest";

import {
  AdminCommunicationPreviewRequestSchema,
  AdminCommunicationPreviewResponseSchema,
  AdminCommunicationDraftCreateRequestSchema,
  AdminCommunicationDraftSchema,
  AdminCommunicationDraftUpdateRequestSchema,
  AdminCommunicationDraftDetailResponseSchema,
  AdminCommunicationsResponseSchema
} from "../src/admin-communications.js";

const response = {
  status: "confirmed" as const,
  timezone: "Europe/Moscow" as const,
  templates: ["promo", "winback", "thankyou", "birthday", "newdish", "coal"].map((code) => ({ code, version: 1, icon: "🔥", title: code, body: "🔥 {name}", variables: ["name" as const] })),
  promoOptions: [],
  channels: [
    { channel: "push" as const, status: "unavailable" as const, reason: "provider_not_connected" as const },
    { channel: "sms" as const, status: "unavailable" as const, reason: "provider_not_connected" as const }
  ],
  draft: { status: "available" as const, reason: "postgres_persistence" as const },
  dispatch: { status: "unavailable" as const, reason: "owner_decision_required" as const },
  export: { status: "unavailable" as const, reason: "owner_decision_required" as const },
  history: { status: "confirmed" as const, message: "Нет истории", drafts: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }
};

describe("admin communications contracts", () => {
  it("keeps templates, channels and history strict and delivery-free", () => {
    expect(AdminCommunicationsResponseSchema.safeParse(response).success).toBe(true);
    expect(AdminCommunicationsResponseSchema.safeParse({ ...response, fakeRecipients: ["+79991231234"] }).success).toBe(false);
    expect(AdminCommunicationsResponseSchema.safeParse({ ...response, history: { ...response.history, drafts: [{ status: "sent" }] } }).success).toBe(false);
  });

  it("bounds preview input and rejects unknown fields or unsupported channels", () => {
    expect(AdminCommunicationPreviewRequestSchema.safeParse({ segmentCode: "regulars", templateCode: "promo", body: "🔥 {name}", channel: "push" }).success).toBe(true);
    expect(AdminCommunicationPreviewRequestSchema.safeParse({ segmentCode: "regulars", templateCode: "promo", body: "🔥 {name}", channel: "email" }).success).toBe(false);
    expect(AdminCommunicationPreviewRequestSchema.safeParse({ segmentCode: "regulars", templateCode: "promo", body: "🔥 {name}", channel: "push", recipients: 1000 }).success).toBe(false);
    expect(AdminCommunicationPreviewRequestSchema.safeParse({ segmentCode: "regulars", templateCode: "promo", body: "x".repeat(2001), channel: "push" }).success).toBe(false);
  });

  it("does not allow delivery statuses in preview responses", () => {
    const valid = {
      status: "confirmed" as const,
      segmentCode: "regulars",
      templateCode: "promo" as const,
      channel: "push" as const,
      recipientCount: 1,
      generatedAt: "2026-09-01T10:00:00.000Z",
      segmentAsOf: "2026-09-01T10:00:00.000Z",
      renderedBody: "🔥 Анна",
      recipientsPreview: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234" }]
    };
    expect(AdminCommunicationPreviewResponseSchema.safeParse(valid).success).toBe(true);
    expect(AdminCommunicationPreviewResponseSchema.safeParse({ ...valid, status: "sent" }).success).toBe(false);
    expect(AdminCommunicationPreviewResponseSchema.safeParse({ ...valid, recipientsPreview: [{ id: 1, name: "Анна", phone: "+79991231234" }] }).success).toBe(false);
  });

  it("bounds persisted draft inputs and keeps delivery states out of draft/history contracts", () => {
    const create = { idempotencyKey: "draft-1", templateCode: "promo", body: "🔥 {name}", channel: "push", delaySeconds: 60, segmentCode: "regulars", promoDefinitionId: null };
    expect(AdminCommunicationDraftCreateRequestSchema.safeParse(create).success).toBe(true);
    expect(AdminCommunicationDraftCreateRequestSchema.safeParse({ ...create, actorStaffUserId: 7 }).success).toBe(false);
    expect(AdminCommunicationDraftCreateRequestSchema.safeParse({ ...create, body: "x".repeat(2001) }).success).toBe(false);
    expect(AdminCommunicationDraftCreateRequestSchema.safeParse({ ...create, delaySeconds: 86_401 }).success).toBe(false);
    expect(AdminCommunicationDraftUpdateRequestSchema.safeParse({ templateCode: create.templateCode, body: create.body, channel: create.channel, delaySeconds: create.delaySeconds, segmentCode: create.segmentCode, promoDefinitionId: null, expectedVersion: 1 }).success).toBe(true);
    expect(AdminCommunicationDraftSchema.safeParse({ id: 1, idempotencyKey: "draft-1", templateCode: "promo", templateVersion: 1, templateTitle: "Промо", body: "🔥 {name}", channel: "push", delaySeconds: 0, segmentCode: "regulars", segmentDefinitionId: "regulars", segmentDefinitionVersion: 1, preview: null, promo: null, status: "sent", createdByStaffUserId: 7, createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", archivedAt: null, version: 1 }).success).toBe(false);
    expect(AdminCommunicationDraftDetailResponseSchema.safeParse({ status: "confirmed", draft: {}, audit: [{ actorStaffUserId: 7, providerStatus: "delivered" }] }).success).toBe(false);
    expect(AdminCommunicationPreviewRequestSchema.safeParse({ segmentCode: "regulars", templateCode: "promo", body: "🔥 {name}", channel: "push", draftId: 1 }).success).toBe(false);
  });
});
