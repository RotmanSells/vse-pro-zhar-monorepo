import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdminCommunicationDraftIdempotencyConflictError, AdminCommunicationDraftVersionConflictError, type AdminCommunicationDraftAuditRepositoryRow, type AdminCommunicationDraftCreateInput, type AdminCommunicationDraftPreviewInput, type AdminCommunicationDraftRepository, type AdminCommunicationDraftRepositoryDetail, type AdminCommunicationDraftRepositoryRow, type AdminCommunicationDraftUpdateInput, type AdminPromoRepository, type AdminSegmentRepository } from "@vse-pro-zhar/database";
import { AdminCommunicationPreviewResponseSchema, AdminCommunicationsResponseSchema, ApiErrorSchema } from "@vse-pro-zhar/contracts";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie } from "./staff-fixtures.js";

function segmentRepository(): AdminSegmentRepository {
  return {
    listBuiltinCounts: async () => [],
    preview: async () => ({
      rows: [
        { id: 1, name: "Анна", phoneMasked: "•••• 1234", orderCount: 3, spentMinor: 450_000, lastActivityAt: new Date("2026-09-01T08:00:00.000Z") },
        { id: 2, name: "Иван", phoneMasked: "•••• 9876", orderCount: 4, spentMinor: 350_000, lastActivityAt: null }
      ],
      total: 2,
      unavailableReason: null
    })
  };
}

function draftRepository(): AdminCommunicationDraftRepository {
  const rows: AdminCommunicationDraftRepositoryRow[] = [];
  const audits: (AdminCommunicationDraftAuditRepositoryRow & { readonly draftId: number })[] = [];
  let nextId = 1;
  let nextAuditId = 1;
  const detail = (draft: AdminCommunicationDraftRepositoryRow): AdminCommunicationDraftRepositoryDetail => ({ draft, audit: audits.filter((entry) => entry.draftId === draft.id).sort((left, right) => right.id - left.id).map((entry) => ({ id: entry.id, action: entry.action, fromStatus: entry.fromStatus, toStatus: entry.toStatus, actorStaffUserId: entry.actorStaffUserId, version: entry.version, createdAt: entry.createdAt })) });
  const audit = (draft: AdminCommunicationDraftRepositoryRow, action: "created" | "updated" | "previewed" | "archived" | "restored", fromStatus: AdminCommunicationDraftRepositoryRow["status"] | null, actorStaffUserId: number, createdAt: Date): void => { audits.push({ id: nextAuditId++, draftId: draft.id, action, fromStatus, toStatus: draft.status, actorStaffUserId, version: draft.version, createdAt }); };
  const find = (id: number): AdminCommunicationDraftRepositoryRow | undefined => rows.find((row) => row.id === id);
  const updateRow = (row: AdminCommunicationDraftRepositoryRow, input: Partial<AdminCommunicationDraftRepositoryRow>): AdminCommunicationDraftRepositoryRow => { Object.assign(row, input); return row; };
  return {
    list: async (query) => { const filtered = rows.filter((row) => (query.status === undefined || row.status === query.status) && (query.search === "" || row.body.includes(query.search) || row.segmentCode.includes(query.search))); return { rows: filtered.slice(query.offset, query.offset + query.limit), total: filtered.length }; },
    get: async (id) => { const row = find(id); return row === undefined ? null : detail(row); },
    getByIdempotencyKey: async (idempotencyKey) => rows.find((row) => row.idempotencyKey === idempotencyKey) ?? null,
    create: async (input: AdminCommunicationDraftCreateInput) => { const existing = rows.find((row) => row.idempotencyKey === input.idempotencyKey); if (existing !== undefined) { if (existing.payloadFingerprint !== input.payloadFingerprint) throw new AdminCommunicationDraftIdempotencyConflictError(); return { draft: existing, created: false }; } const row: AdminCommunicationDraftRepositoryRow = { id: nextId++, payloadFingerprint: input.payloadFingerprint, idempotencyKey: input.idempotencyKey, templateCode: input.templateCode, templateVersion: input.templateVersion, templateTitle: input.templateTitle, body: input.body, channel: input.channel, delaySeconds: input.delaySeconds, segmentCode: input.segmentCode, segmentDefinitionId: input.segmentDefinitionId, segmentDefinitionVersion: input.segmentDefinitionVersion, previewCount: null, previewGeneratedAt: null, previewSegmentAsOf: null, promoDefinitionId: input.promoDefinitionId, promoDefinitionVersion: input.promoDefinitionVersion, promoCode: input.promoCode, promoType: input.promoType, promoValue: input.promoValue, status: "draft", createdByStaffUserId: input.createdByStaffUserId, createdAt: input.createdAt, updatedAt: input.createdAt, archivedAt: null, version: 1 }; rows.push(row); audit(row, "created", null, input.createdByStaffUserId, input.createdAt); return { draft: row, created: true }; },
    update: async (id: number, input: AdminCommunicationDraftUpdateInput) => { const row = find(id); if (row === undefined) return null; if (row.version !== input.expectedVersion) throw new AdminCommunicationDraftVersionConflictError(row); if (row.status === "archived") throw new Error("archived"); const fromStatus = row.status; updateRow(row, { templateCode: input.templateCode, templateVersion: input.templateVersion, templateTitle: input.templateTitle, body: input.body, channel: input.channel, delaySeconds: input.delaySeconds, segmentCode: input.segmentCode, segmentDefinitionId: input.segmentDefinitionId, segmentDefinitionVersion: input.segmentDefinitionVersion, promoDefinitionId: input.promoDefinitionId, promoDefinitionVersion: input.promoDefinitionVersion, promoCode: input.promoCode, promoType: input.promoType, promoValue: input.promoValue, previewCount: null, previewGeneratedAt: null, previewSegmentAsOf: null, status: "draft", updatedAt: input.updatedAt, version: row.version + 1 }); audit(row, "updated", fromStatus, input.actorStaffUserId, input.updatedAt); return detail(row); },
    markPreviewed: async (id: number, input: AdminCommunicationDraftPreviewInput) => { const row = find(id); if (row === undefined) return null; if (row.version !== input.expectedVersion) throw new AdminCommunicationDraftVersionConflictError(row); const fromStatus = row.status; updateRow(row, { status: "previewed", previewCount: input.previewCount, previewGeneratedAt: input.previewGeneratedAt, previewSegmentAsOf: input.previewSegmentAsOf, updatedAt: input.updatedAt, version: row.version + 1 }); audit(row, "previewed", fromStatus, input.actorStaffUserId, input.updatedAt); return detail(row); },
    archive: async (id, expectedVersion, actorStaffUserId, updatedAt) => { const row = find(id); if (row === undefined) return null; if (row.status === "archived") return detail(row); if (row.version !== expectedVersion) throw new AdminCommunicationDraftVersionConflictError(row); const fromStatus = row.status; updateRow(row, { status: "archived", archivedAt: updatedAt, updatedAt, version: row.version + 1 }); audit(row, "archived", fromStatus, actorStaffUserId, updatedAt); return detail(row); },
    restore: async (id, expectedVersion, actorStaffUserId, updatedAt) => { const row = find(id); if (row === undefined) return null; if (row.status !== "archived") return detail(row); if (row.version !== expectedVersion) throw new AdminCommunicationDraftVersionConflictError(row); updateRow(row, { status: "draft", archivedAt: null, updatedAt, version: row.version + 1 }); audit(row, "restored", "archived", actorStaffUserId, updatedAt); return detail(row); }
  };
}

function promoRepository(): AdminPromoRepository {
  const promo = { id: 42, code: "WELCOME10", description: "Fixture promo", type: "percent" as const, value: 10, minimumOrderMinor: 0, currency: "RUB" as const, activeFrom: new Date("2026-01-01T00:00:00.000Z"), activeUntil: null, globalUsageLimit: null, perCustomerUsageLimit: null, stackingPolicy: "none" as const, status: "active" as const, version: 3, usageCount: 0, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-09-01T09:00:00.000Z") };
  return {
    list: async () => ({ rows: [promo], total: 1 }),
    get: async (id) => id === promo.id ? promo : null,
    listRedemptions: async () => null,
    create: async () => { throw new Error("not used"); },
    update: async () => null,
    setActive: async () => null,
    archive: async () => null
  };
}

describe("Admin communications API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), { logger: false, staffRepository: staff.repository, adminSegmentRepository: segmentRepository(), adminCommunicationRepository: draftRepository(), adminPromoRepository: promoRepository(), now: () => new Date("2026-09-01T10:00:00.000Z") });
  });

  afterEach(async () => { await app.close(); });

  it("protects the template/history list and returns truthful capability states", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/communications" })).statusCode).toBe(401);
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "GET", url: "/admin/communications", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const parsed = AdminCommunicationsResponseSchema.parse(response.json());
    expect(parsed.templates[0]?.code).toBe("promo");
    expect(parsed.draft.status).toBe("available");
    expect(parsed.dispatch.status).toBe("unavailable");
    expect(parsed.export.status).toBe("unavailable");
    expect(parsed.history).toMatchObject({ status: "confirmed", drafts: [] });
    expect(JSON.stringify(response.json())).not.toContain("sent");
    expect(JSON.stringify(response.json())).not.toContain("delivered");
  });

  it("renders a live bounded masked preview without provider or delivery side effects", async () => {
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "POST", url: "/admin/communications/preview", headers: { cookie }, payload: { segmentCode: "regulars", templateCode: "promo", body: "🔥 {name}, загляни в приложение", channel: "push" } });
    expect(response.statusCode).toBe(200);
    const parsed = AdminCommunicationPreviewResponseSchema.parse(response.json());
    expect(parsed.status).toBe("confirmed");
    if (parsed.status !== "confirmed") throw new Error("Expected confirmed preview");
    expect(parsed.recipientCount).toBe(2);
    expect(parsed.renderedBody).toBe("🔥 Анна, загляни в приложение");
    expect(parsed.recipientsPreview[0]?.phoneMasked).toBe("•••• 1234");
    expect(JSON.stringify(response.json())).not.toContain("+79991231234");
  });

  it("rejects unknown variables and invalid input safely", async () => {
    const cookie = await staffCookie(app);
    const unknown = await app.inject({ method: "POST", url: "/admin/communications/preview", headers: { cookie }, payload: { segmentCode: "regulars", templateCode: "promo", body: "{discount}", channel: "push" } });
    expect(unknown.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(unknown.json()).error.code).toBe("VALIDATION_ERROR");
    const extra = await app.inject({ method: "POST", url: "/admin/communications/preview", headers: { cookie }, payload: { segmentCode: "regulars", templateCode: "promo", body: "{name}", channel: "email", fakeStatus: "sent" } });
    expect(extra.statusCode).toBe(400);
  });

  it("persists a draft through idempotent create, versioned update, preview and archive routes", async () => {
    const cookie = await staffCookie(app);
    const create = await app.inject({ method: "POST", url: "/admin/communications/drafts", headers: { cookie }, payload: { idempotencyKey: "api-draft-1", templateCode: "promo", body: "🔥 {name}, загляни в приложение", channel: "push", delaySeconds: 60, segmentCode: "regulars", promoDefinitionId: 42 } });
    expect(create.statusCode).toBe(201);
    const draft = create.json().draft as { id: number; version: number };
    expect(create.json().draft.promo).toMatchObject({ definitionId: 42, version: 3, code: "WELCOME10" });
    const repeated = await app.inject({ method: "POST", url: "/admin/communications/drafts", headers: { cookie }, payload: { idempotencyKey: "api-draft-1", templateCode: "promo", body: "🔥 {name}, загляни в приложение", channel: "push", delaySeconds: 60, segmentCode: "regulars", promoDefinitionId: 42 } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().draft.id).toBe(draft.id);
    const idempotencyConflict = await app.inject({ method: "POST", url: "/admin/communications/drafts", headers: { cookie }, payload: { idempotencyKey: "api-draft-1", templateCode: "promo", body: "🔥 {name}, другое сообщение", channel: "push", delaySeconds: 60, segmentCode: "regulars", promoDefinitionId: 42 } });
    expect(idempotencyConflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(idempotencyConflict.json()).error.code).toBe("COMMUNICATION_IDEMPOTENCY_CONFLICT");
    const updated = await app.inject({ method: "PATCH", url: `/admin/communications/drafts/${draft.id}`, headers: { cookie }, payload: { expectedVersion: 1, templateCode: "promo", body: "🔥 {name}, новое сообщение", channel: "push", delaySeconds: 0, segmentCode: "regulars", promoDefinitionId: 42 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().draft.version).toBe(2);
    const conflict = await app.inject({ method: "PATCH", url: `/admin/communications/drafts/${draft.id}`, headers: { cookie }, payload: { expectedVersion: 1, templateCode: "promo", body: "🔥 {name}, потерянное изменение", channel: "push", delaySeconds: 0, segmentCode: "regulars", promoDefinitionId: 42 } });
    expect(conflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(conflict.json()).error.code).toBe("COMMUNICATION_DRAFT_CONFLICT");
    const preview = await app.inject({ method: "POST", url: "/admin/communications/preview", headers: { cookie }, payload: { draftId: draft.id, expectedVersion: 2, segmentCode: "regulars", templateCode: "promo", body: "🔥 {name}, новое сообщение", channel: "push", promoDefinitionId: 42 } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().draft).toMatchObject({ id: draft.id, status: "previewed", version: 3, preview: { recipientCount: 2 } });
    const archived = await app.inject({ method: "POST", url: `/admin/communications/drafts/${draft.id}/archive`, headers: { cookie }, payload: { expectedVersion: 3 } });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().draft).toMatchObject({ status: "archived", version: 4 });
    const detail = await app.inject({ method: "GET", url: `/admin/communications/drafts/${draft.id}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().audit.map((entry: { action: string }) => entry.action)).toEqual(["archived", "previewed", "updated", "created"]);
    expect((await app.inject({ method: "POST", url: "/admin/communications/send", headers: { cookie }, payload: {} })).statusCode).toBe(404);
  });

  it("blocks a draft that references an unknown approved promo", async () => {
    const cookie = await staffCookie(app);
    const response = await app.inject({ method: "POST", url: "/admin/communications/drafts", headers: { cookie }, payload: { idempotencyKey: "api-draft-unknown-promo", templateCode: "promo", body: "🔥 {name}", channel: "push", delaySeconds: 0, segmentCode: "regulars", promoDefinitionId: 999 } });
    expect(response.statusCode).toBe(503);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe("COMMUNICATION_UNAVAILABLE");
  });
});
