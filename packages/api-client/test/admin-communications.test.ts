import { describe, expect, it } from "vitest";

import type { AdminCommunicationDraft, AdminCommunicationDraftDetailResponse, AdminCommunicationDraftResponse, AdminCommunicationPreviewResponse, AdminCommunicationsResponse } from "@vse-pro-zhar/contracts";

import { createAdminCommunicationPreviewRequestController, createAdminCommunicationsClient, createAdminCommunicationsListRequestController } from "../src/index.js";
import type { AdminCommunicationsClient } from "../src/admin-communications-client.js";

const templateCodes = ["promo", "winback", "thankyou", "birthday", "newdish", "coal"] as const;
const listResponse: AdminCommunicationsResponse = {
  status: "confirmed",
  timezone: "Europe/Moscow",
  templates: templateCodes.map((code) => ({ code, version: 1, icon: "🔥", title: code, body: "🔥 {name}", variables: ["name"] as const })),
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
const previewResponse: AdminCommunicationPreviewResponse = {
  status: "confirmed",
  segmentCode: "regulars",
  templateCode: "promo",
  channel: "push",
  recipientCount: 1,
  generatedAt: "2026-09-01T10:00:00.000Z",
  segmentAsOf: "2026-09-01T10:00:00.000Z",
  renderedBody: "🔥 Анна",
  recipientsPreview: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234" }]
};
const draft: AdminCommunicationDraft = {
  id: 1,
  idempotencyKey: "draft-1",
  templateCode: "promo",
  templateVersion: 1,
  templateTitle: "Промо-акция",
  body: "🔥 {name}",
  channel: "push",
  delaySeconds: 0,
  segmentCode: "regulars",
  segmentDefinitionId: "regulars",
  segmentDefinitionVersion: 1,
  preview: null,
  promo: null,
  status: "draft",
  createdByStaffUserId: 1,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  archivedAt: null,
  version: 1
};
const draftResponse: AdminCommunicationDraftResponse = { draft };
const detailResponse: AdminCommunicationDraftDetailResponse = { status: "confirmed", draft, audit: [{ id: 1, action: "created", fromStatus: null, toStatus: "draft", actorStaffUserId: 1, version: 1, createdAt: "2026-09-01T10:00:00.000Z" }] };

describe("admin communications client/controllers", () => {
  it("uses protected list and side-effect-free preview paths", async () => {
    const requests: Array<{ readonly url: string; readonly method: string }> = [];
    const client = createAdminCommunicationsClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async (input, init) => {
      requests.push({ url: input, method: init?.method ?? "GET" });
      return new Response(JSON.stringify(input.endsWith("/preview") ? previewResponse : listResponse), { status: 200, headers: { "content-type": "application/json" } });
    } });
    await client.get();
    await client.preview({ segmentCode: "regulars", templateCode: "promo", body: "🔥 {name}", channel: "push", promoDefinitionId: null });
    expect(requests).toEqual([
      { method: "GET", url: "http://127.0.0.1:3000/admin/communications" },
      { method: "POST", url: "http://127.0.0.1:3000/admin/communications/preview" }
    ]);
  });

  it("uses strict draft endpoints and maps idempotency/version conflicts", async () => {
    const requests: Array<{ readonly url: string; readonly method: string }> = [];
    const client = createAdminCommunicationsClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async (input, init) => {
      requests.push({ url: input, method: init?.method ?? "GET" });
      const body = input.endsWith("/drafts/1") && init?.method === "GET" ? detailResponse : input.includes("/drafts?") ? { status: "confirmed", drafts: [draft], pagination: { limit: 50, offset: 0, total: 1, hasNext: false } } : draftResponse;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    } });
    await client.listDrafts({ status: "draft" });
    await client.getDraft(1);
    await client.createDraft({ idempotencyKey: "draft-1", templateCode: "promo", body: "🔥 {name}", channel: "push", delaySeconds: 0, segmentCode: "regulars", promoDefinitionId: null });
    await client.updateDraft(1, { expectedVersion: 1, templateCode: "promo", body: "🔥 {name}", channel: "push", delaySeconds: 0, segmentCode: "regulars", promoDefinitionId: null });
    await client.archiveDraft(1, { expectedVersion: 1 });
    await client.restoreDraft(1, { expectedVersion: 1 });
    expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST", "PATCH", "POST", "POST"]);
    expect(requests[0]?.url).toContain("status=draft");

    const conflictClient = createAdminCommunicationsClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async () => new Response(JSON.stringify({ error: { code: "COMMUNICATION_DRAFT_CONFLICT", message: "conflict", requestId: "req-1" } }), { status: 409, headers: { "content-type": "application/json" } }) });
    await expect(conflictClient.archiveDraft(1, { expectedVersion: 1 })).rejects.toMatchObject({ kind: "conflict" });
  });

  it("aborts stale list requests and retries the latest preview", async () => {
    const requests: Array<{ readonly signal: AbortSignal | undefined; readonly resolve: (value: AdminCommunicationsResponse) => void }> = [];
    const previewRequests: AdminCommunicationPreviewResponse[] = [previewResponse, previewResponse];
    const draftResponse = {} as AdminCommunicationDraftResponse;
    const client: AdminCommunicationsClient = {
      get: ({ signal } = {}) => new Promise<AdminCommunicationsResponse>((resolve) => { requests.push({ signal, resolve }); }),
      listDrafts: async () => ({ status: "confirmed", drafts: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } }),
      getDraft: async () => ({ status: "confirmed", draft: draftResponse.draft, audit: [] }),
      createDraft: async () => draftResponse,
      updateDraft: async () => draftResponse,
      archiveDraft: async () => draftResponse,
      restoreDraft: async () => draftResponse,
      preview: async () => previewRequests.shift() ?? previewResponse
    };
    const listStates: string[] = [];
    const listController = createAdminCommunicationsListRequestController(client, (state) => listStates.push(state.status));
    listController.load();
    listController.load();
    requests[1]?.resolve(listResponse);
    await Promise.resolve();
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(listStates).toEqual(["loading", "loading", "success"]);
    listController.dispose();

    const previewStates: string[] = [];
    const previewController = createAdminCommunicationPreviewRequestController(client, (state) => previewStates.push(state.status));
    const request = { segmentCode: "regulars" as const, templateCode: "promo" as const, body: "🔥 {name}", channel: "push" as const, promoDefinitionId: null };
    previewController.load(request);
    await Promise.resolve();
    previewController.retry();
    await Promise.resolve();
    expect(previewStates).toEqual(["loading", "success", "loading", "success"]);
    previewController.dispose();
  });
});
