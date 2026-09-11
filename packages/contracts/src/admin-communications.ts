import { z } from "zod";

import { AdminSegmentCodeSchema } from "./admin-segments.js";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_RECIPIENT_PREVIEW = 10;
const MAX_DRAFT_PAGE_LIMIT = 50;
const MAX_AUDIT_ENTRIES = 100;
const MAX_DELAY_SECONDS = 86_400;

const DateTimeSchema = z.iso.datetime({ offset: true });
const IdSchema = z.number().int().positive().max(MAX_POSTGRES_INTEGER);

export const ADMIN_COMMUNICATION_TIMEZONE = "Europe/Moscow" as const;
export const ADMIN_COMMUNICATION_PREVIEW_LIMIT = MAX_RECIPIENT_PREVIEW;
export const ADMIN_COMMUNICATION_MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;
export const ADMIN_COMMUNICATION_DRAFT_PAGE_LIMIT = MAX_DRAFT_PAGE_LIMIT;
export const ADMIN_COMMUNICATION_MAX_AUDIT_ENTRIES = MAX_AUDIT_ENTRIES;
export const ADMIN_COMMUNICATION_MAX_DELAY_SECONDS = MAX_DELAY_SECONDS;

export const AdminCommunicationTemplateCodeSchema = z.enum([
  "promo",
  "winback",
  "thankyou",
  "birthday",
  "newdish",
  "coal"
]);
export type AdminCommunicationTemplateCode = z.infer<typeof AdminCommunicationTemplateCodeSchema>;

export const AdminCommunicationVariableSchema = z.enum([
  "name",
  "order",
  "promo",
  "date",
  "dish",
  "coal"
]);
export type AdminCommunicationVariable = z.infer<typeof AdminCommunicationVariableSchema>;

export const AdminCommunicationTemplateSchema = z.object({
  code: AdminCommunicationTemplateCodeSchema,
  version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  icon: z.string().trim().min(1).max(4),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  variables: z.array(AdminCommunicationVariableSchema).max(6).readonly()
}).strict();
export type AdminCommunicationTemplate = z.infer<typeof AdminCommunicationTemplateSchema>;

export const AdminCommunicationChannelSchema = z.enum(["push", "sms"]);
export type AdminCommunicationChannel = z.infer<typeof AdminCommunicationChannelSchema>;

export const AdminCommunicationChannelStateSchema = z.object({
  channel: AdminCommunicationChannelSchema,
  status: z.literal("unavailable"),
  reason: z.literal("provider_not_connected")
}).strict();
export type AdminCommunicationChannelState = z.infer<typeof AdminCommunicationChannelStateSchema>;

export const AdminCommunicationUnavailableCapabilitySchema = z.object({
  status: z.literal("unavailable"),
  reason: z.literal("owner_decision_required")
}).strict();
export type AdminCommunicationUnavailableCapability = z.infer<typeof AdminCommunicationUnavailableCapabilitySchema>;

export const AdminCommunicationDraftCapabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), reason: z.literal("postgres_persistence") }).strict(),
  AdminCommunicationUnavailableCapabilitySchema
]);
export type AdminCommunicationDraftCapability = z.infer<typeof AdminCommunicationDraftCapabilitySchema>;

export const AdminCommunicationPromoTypeSchema = z.enum(["percent", "fixed"]);
export type AdminCommunicationPromoType = z.infer<typeof AdminCommunicationPromoTypeSchema>;

export const AdminCommunicationPromoOptionSchema = z.object({
  id: IdSchema,
  code: z.string().trim().min(1).max(32),
  version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  type: AdminCommunicationPromoTypeSchema,
  value: z.number().int().positive().max(1_000_000_000)
}).strict();
export type AdminCommunicationPromoOption = z.infer<typeof AdminCommunicationPromoOptionSchema>;

export const AdminCommunicationDraftStatusSchema = z.enum(["draft", "previewed", "archived"]);
export type AdminCommunicationDraftStatus = z.infer<typeof AdminCommunicationDraftStatusSchema>;

export const AdminCommunicationDraftAuditActionSchema = z.enum(["created", "updated", "previewed", "archived", "restored"]);
export type AdminCommunicationDraftAuditAction = z.infer<typeof AdminCommunicationDraftAuditActionSchema>;

const DraftIdempotencyKeySchema = z.string().trim().min(1).max(255);
const DelaySecondsSchema = z.number().int().min(0).max(MAX_DELAY_SECONDS);
const DraftTitleSchema = z.string().trim().min(1).max(80);
const SegmentDefinitionIdSchema = z.string().trim().min(1).max(80);

export const AdminCommunicationDraftPreviewMetadataSchema = z.object({
  recipientCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  generatedAt: DateTimeSchema,
  segmentAsOf: DateTimeSchema
}).strict();
export type AdminCommunicationDraftPreviewMetadata = z.infer<typeof AdminCommunicationDraftPreviewMetadataSchema>;

export const AdminCommunicationDraftPromoSnapshotSchema = z.object({
  definitionId: IdSchema,
  version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  code: z.string().trim().min(1).max(32),
  type: AdminCommunicationPromoTypeSchema,
  value: z.number().int().positive().max(1_000_000_000)
}).strict();
export type AdminCommunicationDraftPromoSnapshot = z.infer<typeof AdminCommunicationDraftPromoSnapshotSchema>;

export const AdminCommunicationDraftSchema = z.object({
  id: IdSchema,
  idempotencyKey: DraftIdempotencyKeySchema,
  templateCode: AdminCommunicationTemplateCodeSchema,
  templateVersion: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  templateTitle: DraftTitleSchema,
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  channel: AdminCommunicationChannelSchema,
  delaySeconds: DelaySecondsSchema,
  segmentCode: AdminSegmentCodeSchema,
  segmentDefinitionId: SegmentDefinitionIdSchema,
  segmentDefinitionVersion: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  preview: AdminCommunicationDraftPreviewMetadataSchema.nullable(),
  promo: AdminCommunicationDraftPromoSnapshotSchema.nullable(),
  status: AdminCommunicationDraftStatusSchema,
  createdByStaffUserId: IdSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  archivedAt: DateTimeSchema.nullable(),
  version: z.number().int().positive().max(MAX_POSTGRES_INTEGER)
}).strict();
export type AdminCommunicationDraft = z.infer<typeof AdminCommunicationDraftSchema>;

export const AdminCommunicationDraftSummarySchema = AdminCommunicationDraftSchema;
export type AdminCommunicationDraftSummary = AdminCommunicationDraft;

export const AdminCommunicationDraftAuditEntrySchema = z.object({
  id: IdSchema,
  action: AdminCommunicationDraftAuditActionSchema,
  fromStatus: AdminCommunicationDraftStatusSchema.nullable(),
  toStatus: AdminCommunicationDraftStatusSchema,
  actorStaffUserId: IdSchema,
  version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  createdAt: DateTimeSchema
}).strict();
export type AdminCommunicationDraftAuditEntry = z.infer<typeof AdminCommunicationDraftAuditEntrySchema>;

export const AdminCommunicationDraftCreateRequestSchema = z.object({
  idempotencyKey: DraftIdempotencyKeySchema,
  templateCode: AdminCommunicationTemplateCodeSchema,
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  channel: AdminCommunicationChannelSchema,
  delaySeconds: DelaySecondsSchema.default(0),
  segmentCode: AdminSegmentCodeSchema,
  promoDefinitionId: IdSchema.nullable().default(null)
}).strict();
export type AdminCommunicationDraftCreateRequest = z.infer<typeof AdminCommunicationDraftCreateRequestSchema>;

export const AdminCommunicationDraftUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  templateCode: AdminCommunicationTemplateCodeSchema,
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  channel: AdminCommunicationChannelSchema,
  delaySeconds: DelaySecondsSchema.default(0),
  segmentCode: AdminSegmentCodeSchema,
  promoDefinitionId: IdSchema.nullable().default(null)
}).strict();
export type AdminCommunicationDraftUpdateRequest = z.infer<typeof AdminCommunicationDraftUpdateRequestSchema>;

export const AdminCommunicationDraftVersionRequestSchema = z.object({
  expectedVersion: z.number().int().positive().max(MAX_POSTGRES_INTEGER)
}).strict();
export type AdminCommunicationDraftVersionRequest = z.infer<typeof AdminCommunicationDraftVersionRequestSchema>;

export const AdminCommunicationDraftsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_DRAFT_PAGE_LIMIT).default(MAX_DRAFT_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).max(MAX_POSTGRES_INTEGER).default(0),
  status: AdminCommunicationDraftStatusSchema.optional(),
  search: z.string().trim().max(80).default("")
}).strict();
export type AdminCommunicationDraftsQuery = z.infer<typeof AdminCommunicationDraftsQuerySchema>;
export type AdminCommunicationDraftsQueryInput = z.input<typeof AdminCommunicationDraftsQuerySchema>;

export const AdminCommunicationDraftResponseSchema = z.object({ draft: AdminCommunicationDraftSchema }).strict();
export type AdminCommunicationDraftResponse = z.infer<typeof AdminCommunicationDraftResponseSchema>;

export const AdminCommunicationDraftListResponseSchema = z.object({
  status: z.literal("confirmed"),
  drafts: z.array(AdminCommunicationDraftSummarySchema).max(MAX_DRAFT_PAGE_LIMIT).readonly(),
  pagination: z.object({
    limit: z.number().int().min(1).max(MAX_DRAFT_PAGE_LIMIT),
    offset: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
    total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    hasNext: z.boolean()
  }).strict()
}).strict();
export type AdminCommunicationDraftListResponse = z.infer<typeof AdminCommunicationDraftListResponseSchema>;

export const AdminCommunicationDraftDetailResponseSchema = z.object({
  status: z.literal("confirmed"),
  draft: AdminCommunicationDraftSchema,
  audit: z.array(AdminCommunicationDraftAuditEntrySchema).max(MAX_AUDIT_ENTRIES).readonly()
}).strict();
export type AdminCommunicationDraftDetailResponse = z.infer<typeof AdminCommunicationDraftDetailResponseSchema>;

export const AdminCommunicationHistorySchema = z.object({
  status: z.literal("confirmed"),
  message: z.string().trim().min(1).max(240),
  drafts: z.array(AdminCommunicationDraftSummarySchema).max(MAX_DRAFT_PAGE_LIMIT).readonly(),
  pagination: z.object({
    limit: z.number().int().min(1).max(MAX_POSTGRES_INTEGER),
    offset: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
    total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    hasNext: z.boolean()
  }).strict()
}).strict();
export type AdminCommunicationHistory = z.infer<typeof AdminCommunicationHistorySchema>;

export const AdminCommunicationsResponseSchema = z.object({
  status: z.literal("confirmed"),
  timezone: z.literal(ADMIN_COMMUNICATION_TIMEZONE),
  templates: z.array(AdminCommunicationTemplateSchema).length(6).readonly(),
  promoOptions: z.array(AdminCommunicationPromoOptionSchema).max(MAX_DRAFT_PAGE_LIMIT).readonly(),
  channels: z.array(AdminCommunicationChannelStateSchema).length(2).readonly(),
  draft: AdminCommunicationDraftCapabilitySchema,
  dispatch: AdminCommunicationUnavailableCapabilitySchema,
  export: AdminCommunicationUnavailableCapabilitySchema,
  history: AdminCommunicationHistorySchema
}).strict().superRefine((response, context) => {
  const codes = response.templates.map((template) => template.code);
  if (new Set(codes).size !== 6) context.addIssue({ code: "custom", message: "Communication templates must have unique codes", path: ["templates"] });
  const channels = response.channels.map((channel) => channel.channel);
  if (new Set(channels).size !== 2 || !channels.includes("push") || !channels.includes("sms")) context.addIssue({ code: "custom", message: "Communication channels must contain push and sms", path: ["channels"] });
}).readonly();
export type AdminCommunicationsResponse = z.infer<typeof AdminCommunicationsResponseSchema>;

const MessageBodySchema = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);

export const AdminCommunicationPreviewRequestSchema = z.object({
  segmentCode: AdminSegmentCodeSchema,
  templateCode: AdminCommunicationTemplateCodeSchema,
  body: MessageBodySchema,
  channel: AdminCommunicationChannelSchema,
  draftId: IdSchema.optional(),
  expectedVersion: z.number().int().positive().max(MAX_POSTGRES_INTEGER).optional(),
  promoDefinitionId: IdSchema.nullable().optional()
}).strict().superRefine((input, context) => {
  if (input.draftId !== undefined && input.expectedVersion === undefined) context.addIssue({ code: "custom", path: ["expectedVersion"], message: "Draft preview requires expectedVersion" });
  if (input.draftId === undefined && input.expectedVersion !== undefined) context.addIssue({ code: "custom", path: ["draftId"], message: "expectedVersion requires draftId" });
});
export type AdminCommunicationPreviewRequest = z.infer<typeof AdminCommunicationPreviewRequestSchema>;

export const AdminCommunicationRecipientPreviewSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(160),
  phoneMasked: z.string().trim().min(1).max(32)
}).strict();
export type AdminCommunicationRecipientPreview = z.infer<typeof AdminCommunicationRecipientPreviewSchema>;

export const AdminCommunicationPreviewResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("confirmed"),
    segmentCode: AdminSegmentCodeSchema,
    templateCode: AdminCommunicationTemplateCodeSchema,
    channel: AdminCommunicationChannelSchema,
    recipientCount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      generatedAt: DateTimeSchema,
      segmentAsOf: DateTimeSchema,
      renderedBody: MessageBodySchema,
    recipientsPreview: z.array(AdminCommunicationRecipientPreviewSchema).max(MAX_RECIPIENT_PREVIEW).readonly(),
    draft: AdminCommunicationDraftSchema.optional()
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    segmentCode: AdminSegmentCodeSchema,
    templateCode: AdminCommunicationTemplateCodeSchema,
    channel: AdminCommunicationChannelSchema,
    generatedAt: DateTimeSchema,
    reason: z.enum(["segment_unavailable", "empty_audience", "variable_unavailable"]),
    message: z.string().trim().min(1).max(240),
    recipientsPreview: z.array(z.never()).max(0).readonly()
  }).strict()
]);
export type AdminCommunicationPreviewResponse = z.infer<typeof AdminCommunicationPreviewResponseSchema>;
