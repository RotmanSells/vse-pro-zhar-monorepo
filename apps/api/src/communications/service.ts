import { createHash } from "node:crypto";

import {
  AdminCommunicationDraftDetailResponseSchema,
  AdminCommunicationDraftListResponseSchema,
  AdminCommunicationDraftResponseSchema,
  AdminCommunicationPreviewResponseSchema,
  AdminCommunicationTemplateCodeSchema,
  AdminCommunicationVariableSchema,
  AdminCommunicationsResponseSchema,
  type AdminCommunicationDraft,
  type AdminCommunicationDraftCreateRequest,
  type AdminCommunicationDraftDetailResponse,
  type AdminCommunicationDraftResponse,
  type AdminCommunicationDraftUpdateRequest,
  type AdminCommunicationPreviewRequest,
  type AdminCommunicationPreviewResponse,
  type AdminCommunicationTemplate,
  type AdminCommunicationsResponse,
  type AdminCommunicationDraftListResponse,
  AdminSegmentCodeSchema
} from "@vse-pro-zhar/contracts";
import {
  AdminCommunicationDraftIdempotencyConflictError
} from "@vse-pro-zhar/database";
import type {
  AdminCommunicationDraftRepository,
  AdminCommunicationDraftRepositoryDetail,
  AdminCommunicationDraftRepositoryRow,
  AdminPromoRepository,
  AdminSegmentRepository
} from "@vse-pro-zhar/database";

import { ADMIN_SEGMENT_DEFINITION_VERSION } from "../segments/service.js";

export const ADMIN_COMMUNICATION_TIMEZONE = "Europe/Moscow" as const;

const COMMUNICATION_TEMPLATES: readonly AdminCommunicationTemplate[] = [
  { code: "promo", version: 1, icon: "🎁", title: "Промо-акция", body: "🔥 {name}, для тебя есть специальное предложение. Открой приложение, чтобы узнать условия акции.", variables: ["name"] },
  { code: "winback", version: 1, icon: "💔", title: "Вернуть клиента", body: "💔 {name}, мы скучаем по тебе! Возвращайся в приложение — будем рады видеть.", variables: ["name"] },
  { code: "thankyou", version: 1, icon: "🙏", title: "Благодарность", body: "🙏 {name}, спасибо, что выбираешь «Все Про Жар»! Ждём тебя снова.", variables: ["name"] },
  { code: "birthday", version: 1, icon: "🎂", title: "День рождения", body: "🎂 {name}, поздравляем! Открой приложение, чтобы посмотреть персональное предложение.", variables: ["name"] },
  { code: "newdish", version: 1, icon: "🆕", title: "Новинка в меню", body: "🆕 {name}, в меню «Все Про Жар» появилась новинка. Открой приложение и попробуй её 🔥", variables: ["name"] },
  { code: "coal", version: 1, icon: "🔥", title: "Напоминание об угольках", body: "🔥 {name}, твои подтверждённые угольки ждут тебя в приложении.", variables: ["name"] }
];

const ALLOWED_VARIABLES = new Set(AdminCommunicationVariableSchema.options);

export class AdminCommunicationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminCommunicationValidationError";
  }
}

export class AdminCommunicationUnavailableError extends Error {
  constructor(message = "Communication data is unavailable") {
    super(message);
    this.name = "AdminCommunicationUnavailableError";
  }
}

export class AdminCommunicationNotFoundError extends Error {
  constructor() {
    super("Communication draft was not found");
    this.name = "AdminCommunicationNotFoundError";
  }
}

function assertClock(now: Date): void {
  if (Number.isNaN(now.getTime())) throw new AdminCommunicationValidationError("Communication clock is invalid");
}

function templateFor(code: string): AdminCommunicationTemplate {
  const parsed = AdminCommunicationTemplateCodeSchema.safeParse(code);
  if (!parsed.success) throw new AdminCommunicationValidationError("Communication template is unknown");
  const template = COMMUNICATION_TEMPLATES.find((candidate) => candidate.code === parsed.data);
  if (template === undefined) throw new AdminCommunicationUnavailableError("Communication template is unavailable");
  return template;
}

function variablesIn(body: string): readonly string[] {
  return Array.from(body.matchAll(/\{([^{}]+)\}/gu), (match) => match[1] ?? "");
}

function assertVariablesAreKnown(body: string): void {
  if (/[{}]/u.test(body.replace(/\{(?:name|order|promo|date|dish|coal)\}/gu, ""))) throw new AdminCommunicationValidationError("Сообщение содержит некорректную переменную");
  for (const variable of variablesIn(body)) {
    if (!ALLOWED_VARIABLES.has(variable as never)) throw new AdminCommunicationValidationError("Сообщение содержит неизвестную переменную");
  }
}

function missingVariable(body: string): boolean {
  return variablesIn(body).some((variable) => variable !== "name");
}

function unavailableResponse(input: AdminCommunicationPreviewRequest, now: Date, reason: "segment_unavailable" | "empty_audience" | "variable_unavailable", message: string): AdminCommunicationPreviewResponse {
  return AdminCommunicationPreviewResponseSchema.parse({
    status: "unavailable",
    segmentCode: input.segmentCode,
    templateCode: input.templateCode,
    channel: input.channel,
    generatedAt: now.toISOString(),
    reason,
    message,
    recipientsPreview: []
  });
}

function toDraft(row: AdminCommunicationDraftRepositoryRow): AdminCommunicationDraft {
  const preview = row.previewCount === null || row.previewGeneratedAt === null || row.previewSegmentAsOf === null
    ? null
    : { recipientCount: row.previewCount, generatedAt: row.previewGeneratedAt.toISOString(), segmentAsOf: row.previewSegmentAsOf.toISOString() };
  const promo = row.promoDefinitionId === null || row.promoDefinitionVersion === null || row.promoCode === null || row.promoType === null || row.promoValue === null
    ? null
    : { definitionId: row.promoDefinitionId, version: row.promoDefinitionVersion, code: row.promoCode, type: row.promoType, value: row.promoValue };
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    templateCode: row.templateCode as AdminCommunicationDraft["templateCode"],
    templateVersion: row.templateVersion,
    templateTitle: row.templateTitle,
    body: row.body,
    channel: row.channel,
    delaySeconds: row.delaySeconds,
    segmentCode: row.segmentCode as AdminCommunicationDraft["segmentCode"],
    segmentDefinitionId: row.segmentDefinitionId,
    segmentDefinitionVersion: row.segmentDefinitionVersion,
    preview,
    promo,
    status: row.status,
    createdByStaffUserId: row.createdByStaffUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version
  };
}

function draftResponse(detail: AdminCommunicationDraftRepositoryDetail): AdminCommunicationDraftDetailResponse {
  return AdminCommunicationDraftDetailResponseSchema.parse({
    status: "confirmed",
    draft: toDraft(detail.draft),
    audit: detail.audit.map((entry) => ({
      id: entry.id,
      action: entry.action,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorStaffUserId: entry.actorStaffUserId,
      version: entry.version,
      createdAt: entry.createdAt.toISOString()
    }))
  });
}

function draftOnlyResponse(row: AdminCommunicationDraftRepositoryRow): AdminCommunicationDraftResponse {
  return AdminCommunicationDraftResponseSchema.parse({ draft: toDraft(row) });
}

function fingerprint(input: AdminCommunicationDraftCreateRequest): string {
  return createHash("sha256").update(JSON.stringify({
    templateCode: input.templateCode,
    body: input.body,
    channel: input.channel,
    delaySeconds: input.delaySeconds,
    segmentCode: input.segmentCode,
    promoDefinitionId: input.promoDefinitionId
  })).digest("hex");
}

async function resolveSegment(repository: AdminSegmentRepository, segmentCode: string, now: Date): Promise<{ readonly code: string; readonly count: number }> {
  const parsed = AdminSegmentCodeSchema.safeParse(segmentCode);
  if (!parsed.success) throw new AdminCommunicationValidationError("Communication segment is unknown");
  const preview = await repository.preview(parsed.data, { limit: 1, offset: 0 }, now);
  if (preview.unavailableReason !== null) throw new AdminCommunicationUnavailableError("Аудитория сегмента временно недоступна: Backend требует сверку данных.");
  return { code: parsed.data, count: preview.total };
}

async function resolvePromo(repository: AdminPromoRepository | undefined, promoDefinitionId: number | null, now: Date) {
  if (promoDefinitionId === null) return null;
  if (repository === undefined) throw new AdminCommunicationUnavailableError("Прикрепление промокода временно недоступно.");
  const promo = await repository.get(promoDefinitionId);
  if (promo === null || promo.status !== "active" || promo.activeFrom > now || (promo.activeUntil !== null && promo.activeUntil <= now)) {
    throw new AdminCommunicationUnavailableError("Промокод недоступен или больше не активен.");
  }
  return { definitionId: promo.id, version: promo.version, code: promo.code, type: promo.type, value: promo.value };
}

function emptyHistoryMessage(total: number): string {
  return total === 0 ? "Сохранённых черновиков пока нет." : "История черновиков загружена из Backend.";
}

export async function getAdminCommunications(
  repository: AdminCommunicationDraftRepository,
  promoRepository: AdminPromoRepository | undefined,
  query: { readonly limit: number; readonly offset: number; readonly status?: "draft" | "previewed" | "archived" | undefined; readonly search: string },
  now: Date
): Promise<AdminCommunicationsResponse> {
  assertClock(now);
  const [drafts, promos] = await Promise.all([
    repository.list(query),
    promoRepository === undefined ? Promise.resolve({ rows: [], total: 0 }) : promoRepository.list({ limit: 50, offset: 0, search: "", status: "active" })
  ]);
  return AdminCommunicationsResponseSchema.parse({
    status: "confirmed",
    timezone: ADMIN_COMMUNICATION_TIMEZONE,
    templates: COMMUNICATION_TEMPLATES,
    promoOptions: promos.rows.map((promo) => ({ id: promo.id, code: promo.code, version: promo.version, type: promo.type, value: promo.value })),
    channels: [
      { channel: "push", status: "unavailable", reason: "provider_not_connected" },
      { channel: "sms", status: "unavailable", reason: "provider_not_connected" }
    ],
    draft: { status: "available", reason: "postgres_persistence" },
    dispatch: { status: "unavailable", reason: "owner_decision_required" },
    export: { status: "unavailable", reason: "owner_decision_required" },
    history: {
      status: "confirmed",
      message: emptyHistoryMessage(drafts.total),
      drafts: drafts.rows.map(toDraft),
      pagination: { limit: query.limit, offset: query.offset, total: drafts.total, hasNext: query.offset + drafts.rows.length < drafts.total }
    }
  });
}

export async function listAdminCommunicationDrafts(repository: AdminCommunicationDraftRepository, query: { readonly limit: number; readonly offset: number; readonly status?: "draft" | "previewed" | "archived" | undefined; readonly search: string }): Promise<AdminCommunicationDraftListResponse> {
  const result = await repository.list(query);
  return AdminCommunicationDraftListResponseSchema.parse({
    status: "confirmed",
    drafts: result.rows.map(toDraft),
    pagination: { limit: query.limit, offset: query.offset, total: result.total, hasNext: query.offset + result.rows.length < result.total }
  });
}

export async function getAdminCommunicationDraft(repository: AdminCommunicationDraftRepository, id: number): Promise<AdminCommunicationDraftDetailResponse> {
  const detail = await repository.get(id);
  if (detail === null) throw new AdminCommunicationNotFoundError();
  return draftResponse(detail);
}

async function draftInputParts(
  segmentRepository: AdminSegmentRepository,
  promoRepository: AdminPromoRepository | undefined,
  input: { readonly templateCode: string; readonly body: string; readonly channel: "push" | "sms"; readonly delaySeconds: number; readonly segmentCode: string; readonly promoDefinitionId: number | null },
  now: Date
) {
  const template = templateFor(input.templateCode);
  assertVariablesAreKnown(input.body);
  if (missingVariable(input.body)) throw new AdminCommunicationUnavailableError("Для этой переменной нет подтверждённых данных в выбранном preview.");
  const segment = await resolveSegment(segmentRepository, input.segmentCode, now);
  const promo = await resolvePromo(promoRepository, input.promoDefinitionId, now);
  return { template, segment, promo };
}

export async function createAdminCommunicationDraft(
  repository: AdminCommunicationDraftRepository,
  segmentRepository: AdminSegmentRepository,
  promoRepository: AdminPromoRepository | undefined,
  input: AdminCommunicationDraftCreateRequest,
  staffUserId: number,
  now: Date
): Promise<{ readonly response: AdminCommunicationDraftResponse; readonly created: boolean }> {
  assertClock(now);
  const payloadFingerprint = fingerprint(input);
  const existing = await repository.getByIdempotencyKey(input.idempotencyKey);
  if (existing !== null) {
    if (existing.payloadFingerprint !== payloadFingerprint) throw new AdminCommunicationDraftIdempotencyConflictError();
    return { response: draftOnlyResponse(existing), created: false };
  }
  const parts = await draftInputParts(segmentRepository, promoRepository, { ...input, promoDefinitionId: input.promoDefinitionId ?? null }, now);
  const result = await repository.create({
    idempotencyKey: input.idempotencyKey,
    payloadFingerprint,
    templateCode: parts.template.code,
    templateVersion: parts.template.version,
    templateTitle: parts.template.title,
    body: input.body,
    channel: input.channel,
    delaySeconds: input.delaySeconds,
    segmentCode: parts.segment.code,
    segmentDefinitionId: parts.segment.code,
    segmentDefinitionVersion: ADMIN_SEGMENT_DEFINITION_VERSION,
    promoDefinitionId: parts.promo?.definitionId ?? null,
    promoDefinitionVersion: parts.promo?.version ?? null,
    promoCode: parts.promo?.code ?? null,
    promoType: parts.promo?.type ?? null,
    promoValue: parts.promo?.value ?? null,
    createdByStaffUserId: staffUserId,
    createdAt: now
  });
  return { response: draftOnlyResponse(result.draft), created: result.created };
}

export async function updateAdminCommunicationDraft(
  repository: AdminCommunicationDraftRepository,
  segmentRepository: AdminSegmentRepository,
  promoRepository: AdminPromoRepository | undefined,
  id: number,
  input: AdminCommunicationDraftUpdateRequest,
  staffUserId: number,
  now: Date
): Promise<AdminCommunicationDraftResponse> {
  assertClock(now);
  const parts = await draftInputParts(segmentRepository, promoRepository, { ...input, promoDefinitionId: input.promoDefinitionId ?? null }, now);
  const detail = await repository.update(id, {
    expectedVersion: input.expectedVersion,
    templateCode: parts.template.code,
    templateVersion: parts.template.version,
    templateTitle: parts.template.title,
    body: input.body,
    channel: input.channel,
    delaySeconds: input.delaySeconds,
    segmentCode: parts.segment.code,
    segmentDefinitionId: parts.segment.code,
    segmentDefinitionVersion: ADMIN_SEGMENT_DEFINITION_VERSION,
    promoDefinitionId: parts.promo?.definitionId ?? null,
    promoDefinitionVersion: parts.promo?.version ?? null,
    promoCode: parts.promo?.code ?? null,
    promoType: parts.promo?.type ?? null,
    promoValue: parts.promo?.value ?? null,
    actorStaffUserId: staffUserId,
    updatedAt: now
  });
  if (detail === null) throw new AdminCommunicationNotFoundError();
  return draftOnlyResponse(detail.draft);
}

export async function archiveAdminCommunicationDraft(repository: AdminCommunicationDraftRepository, id: number, expectedVersion: number, staffUserId: number, now: Date): Promise<AdminCommunicationDraftResponse> {
  assertClock(now);
  const detail = await repository.archive(id, expectedVersion, staffUserId, now);
  if (detail === null) throw new AdminCommunicationNotFoundError();
  return draftOnlyResponse(detail.draft);
}

export async function restoreAdminCommunicationDraft(repository: AdminCommunicationDraftRepository, id: number, expectedVersion: number, staffUserId: number, now: Date): Promise<AdminCommunicationDraftResponse> {
  assertClock(now);
  const detail = await repository.restore(id, expectedVersion, staffUserId, now);
  if (detail === null) throw new AdminCommunicationNotFoundError();
  return draftOnlyResponse(detail.draft);
}

export async function previewAdminCommunication(
  segmentRepository: AdminSegmentRepository,
  draftRepository: AdminCommunicationDraftRepository | undefined,
  promoRepository: AdminPromoRepository | undefined,
  input: AdminCommunicationPreviewRequest,
  staffUserId: number,
  now: Date
): Promise<AdminCommunicationPreviewResponse> {
  assertClock(now);
  const template = templateFor(input.templateCode);
  const parsedSegmentCode = AdminSegmentCodeSchema.safeParse(input.segmentCode);
  if (!parsedSegmentCode.success) throw new AdminCommunicationValidationError("Communication segment is unknown");
  assertVariablesAreKnown(input.body);
  if (missingVariable(input.body)) return unavailableResponse(input, now, "variable_unavailable", "Для этой переменной нет подтверждённых данных в выбранном preview.");
  await resolvePromo(promoRepository, input.promoDefinitionId ?? null, now);
  let currentDraft: AdminCommunicationDraftRepositoryDetail | null = null;
  if (input.draftId !== undefined) {
    if (draftRepository === undefined || input.expectedVersion === undefined) throw new AdminCommunicationUnavailableError("Сохранение preview временно недоступно.");
    currentDraft = await draftRepository.get(input.draftId);
    if (currentDraft === null) throw new AdminCommunicationNotFoundError();
    if (currentDraft.draft.version !== input.expectedVersion || currentDraft.draft.templateCode !== template.code || currentDraft.draft.body !== input.body || currentDraft.draft.channel !== input.channel || currentDraft.draft.segmentCode !== parsedSegmentCode.data || currentDraft.draft.promoDefinitionId !== (input.promoDefinitionId ?? null)) {
      throw new AdminCommunicationValidationError("Preview запроса не совпадает с текущим черновиком");
    }
  }
  const preview = await segmentRepository.preview(parsedSegmentCode.data, { limit: 10, offset: 0 }, now);
  if (preview.unavailableReason !== null) return unavailableResponse(input, now, "segment_unavailable", "Аудитория сегмента временно недоступна: Backend требует сверку данных.");
  if (preview.total === 0 || preview.rows[0] === undefined) return unavailableResponse(input, now, "empty_audience", "В выбранном сегменте пока нет клиентов для preview.");
  const response = AdminCommunicationPreviewResponseSchema.parse({
    status: "confirmed",
    segmentCode: input.segmentCode,
    templateCode: template.code,
    channel: input.channel,
    recipientCount: preview.total,
    generatedAt: now.toISOString(),
    segmentAsOf: now.toISOString(),
    renderedBody: input.body.replaceAll("{name}", preview.rows[0].name),
    recipientsPreview: preview.rows.map((row) => ({ id: row.id, name: row.name, phoneMasked: row.phoneMasked }))
  });
  if (response.status !== "confirmed") return response;
  if (currentDraft !== null && draftRepository !== undefined && input.expectedVersion !== undefined && input.draftId !== undefined) {
    const updated = await draftRepository.markPreviewed(input.draftId, { expectedVersion: input.expectedVersion, previewCount: response.recipientCount, previewGeneratedAt: now, previewSegmentAsOf: now, actorStaffUserId: staffUserId, updatedAt: now });
    if (updated === null) throw new AdminCommunicationNotFoundError();
    return AdminCommunicationPreviewResponseSchema.parse({ ...response, draft: toDraft(updated.draft) });
  }
  return response;
}

export function getCommunicationTemplate(code: string): AdminCommunicationTemplate {
  return templateFor(code);
}
