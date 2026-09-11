import { z } from "zod";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

const IdSchema = z.number().int().positive().max(MAX_POSTGRES_INTEGER).refine(Number.isSafeInteger);
const UnitSchema = z.number().int().min(0).max(MAX_POSTGRES_INTEGER).refine(Number.isSafeInteger);
const DateTimeSchema = z.iso.datetime({ offset: true });
const TextSchema = z.string().trim().min(1).max(240);
const NullableDateTimeSchema = DateTimeSchema.nullable();

const WheelMinOrderAmountMinorSchema = z.number().int().min(0).max(MAX_POSTGRES_INTEGER).refine(Number.isSafeInteger);
const WheelPositiveLimitSchema = z.number().int().positive().max(MAX_POSTGRES_INTEGER).refine(Number.isSafeInteger);

export const M14_WHEEL_MIN_ORDER_AMOUNT_MINOR = 150_000;
export const M14_WHEEL_COOLDOWN_SECONDS = 86_400;
export const M14_WHEEL_LIMIT_PERIOD_SECONDS = 86_400;
export const M14_WHEEL_MAX_SPINS = 1;
export const M14_WHEEL_MAX_PRIZES = 6;
export const M14_WHEEL_RULE_VERSION = 1;
export const M14_QUEST_RULE_VERSION = 1;

export const WheelEligibilitySchema = z.literal("completed_paid_order");
export type WheelEligibility = z.infer<typeof WheelEligibilitySchema>;

export const WheelPrizeTypeSchema = z.enum(["no_prize", "coal", "xp"]);
export type WheelPrizeType = z.infer<typeof WheelPrizeTypeSchema>;

export const WheelSettingsSchema = z
  .object({
    id: IdSchema,
    enabled: z.boolean(),
    eligibility: WheelEligibilitySchema,
    minOrderAmountMinor: WheelMinOrderAmountMinorSchema,
    currency: z.literal("RUB"),
    cooldownSeconds: WheelPositiveLimitSchema,
    maxSpins: WheelPositiveLimitSchema,
    limitPeriodSeconds: WheelPositiveLimitSchema,
    activeFrom: NullableDateTimeSchema,
    activeUntil: NullableDateTimeSchema,
    version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
    updatedAt: DateTimeSchema
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.activeFrom !== null && settings.activeUntil !== null && new Date(settings.activeUntil).getTime() <= new Date(settings.activeFrom).getTime()) {
      context.addIssue({ code: "custom", message: "Wheel active period is invalid", path: ["activeUntil"] });
    }
  });
export type WheelSettings = z.infer<typeof WheelSettingsSchema>;

export const WheelPrizeSchema = z
  .object({
    id: IdSchema,
    code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u),
    name: TextSchema,
    description: z.string().max(2048),
    type: WheelPrizeTypeSchema,
    value: UnitSchema,
    weight: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
    isVisible: z.boolean(),
    activeFrom: NullableDateTimeSchema,
    activeUntil: NullableDateTimeSchema,
    sortOrder: UnitSchema,
    version: z.number().int().positive().max(MAX_POSTGRES_INTEGER)
  })
  .strict()
  .superRefine((prize, context) => {
    if (prize.type === "no_prize" && prize.value !== 0) {
      context.addIssue({ code: "custom", message: "No-prize value must be zero", path: ["value"] });
    }
    if (prize.type !== "no_prize" && prize.value < 1) {
      context.addIssue({ code: "custom", message: "Reward value must be positive", path: ["value"] });
    }
    if (prize.activeFrom !== null && prize.activeUntil !== null && prize.activeUntil <= prize.activeFrom) {
      context.addIssue({ code: "custom", message: "Prize active period is invalid", path: ["activeUntil"] });
    }
  });
export type WheelPrize = z.infer<typeof WheelPrizeSchema>;

export const WheelPrizeCreateRequestSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u),
    name: TextSchema,
    description: z.string().max(2048),
    type: WheelPrizeTypeSchema,
    value: UnitSchema,
    weight: UnitSchema,
    isVisible: z.boolean(),
    activeFrom: NullableDateTimeSchema,
    activeUntil: NullableDateTimeSchema,
    sortOrder: UnitSchema
  })
  .strict()
  .superRefine((prize, context) => {
    if (prize.type === "no_prize" && prize.value !== 0) {
      context.addIssue({ code: "custom", message: "No-prize value must be zero", path: ["value"] });
    }
    if (prize.type !== "no_prize" && prize.value < 1) {
      context.addIssue({ code: "custom", message: "Reward value must be positive", path: ["value"] });
    }
    if (prize.activeFrom !== null && prize.activeUntil !== null && prize.activeUntil <= prize.activeFrom) {
      context.addIssue({ code: "custom", message: "Prize active period is invalid", path: ["activeUntil"] });
    }
  });
export type WheelPrizeCreateRequest = z.infer<typeof WheelPrizeCreateRequestSchema>;

export const WheelPrizePublicSchema = z.object({
  id: IdSchema,
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u),
  name: TextSchema,
  description: z.string().max(2048),
  type: WheelPrizeTypeSchema,
  value: UnitSchema,
  sortOrder: UnitSchema
}).strict();
export type WheelPrizePublic = z.infer<typeof WheelPrizePublicSchema>;

export const WheelEligibilityReasonSchema = z.enum([
  "eligible",
  "disabled",
  "outside_active_period",
  "cooldown",
  "limit_reached",
  "no_eligible_order",
  "not_configured",
  "reconciliation_required"
]);
export type WheelEligibilityReason = z.infer<typeof WheelEligibilityReasonSchema>;

export const WheelEligibilityStateSchema = z
  .object({
    canSpin: z.boolean(),
    reason: WheelEligibilityReasonSchema,
    eligibleOrderId: IdSchema.nullable(),
    cooldownUntil: DateTimeSchema.nullable()
  })
  .strict()
  .superRefine((state, context) => {
    if (state.canSpin && (state.reason !== "eligible" || state.eligibleOrderId === null)) {
      context.addIssue({ code: "custom", message: "Eligible state must contain an order", path: ["eligibleOrderId"] });
    }
    if (!state.canSpin && state.reason === "eligible") {
      context.addIssue({ code: "custom", message: "Ineligible state cannot use eligible reason", path: ["reason"] });
    }
  });
export type WheelEligibilityState = z.infer<typeof WheelEligibilityStateSchema>;

export const WheelRewardClaimStatusSchema = z.enum(["not_applicable", "succeeded", "reconciliation_required"]);
export type WheelRewardClaimStatus = z.infer<typeof WheelRewardClaimStatusSchema>;

export const WheelSpinSchema = z
  .object({
    id: IdSchema,
    sourceOrderId: IdSchema,
    prize: WheelPrizePublicSchema,
    status: z.literal("completed"),
    rewardClaimStatus: WheelRewardClaimStatusSchema,
    createdAt: DateTimeSchema
  })
  .strict();
export type WheelSpin = z.infer<typeof WheelSpinSchema>;

export const WheelStateResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("confirmed"),
    settings: WheelSettingsSchema,
    prizes: z.array(WheelPrizePublicSchema).max(M14_WHEEL_MAX_PRIZES),
    eligibility: WheelEligibilityStateSchema,
    spins: z.array(WheelSpinSchema).max(100)
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum(["not_configured", "reconciliation_required"])
  }).strict()
]);
export type WheelStateResponse = z.infer<typeof WheelStateResponseSchema>;

export const WheelSpinRequestSchema = z.object({ orderId: IdSchema }).strict();
export type WheelSpinRequest = z.infer<typeof WheelSpinRequestSchema>;

export const WheelSpinResponseSchema = z.object({
  status: z.literal("completed"),
  spin: WheelSpinSchema
}).strict();
export type WheelSpinResponse = z.infer<typeof WheelSpinResponseSchema>;

export const WheelSettingsUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive().max(MAX_POSTGRES_INTEGER).refine(Number.isSafeInteger),
  enabled: z.boolean().optional(),
  minOrderAmountMinor: WheelMinOrderAmountMinorSchema.optional(),
  cooldownSeconds: WheelPositiveLimitSchema.optional(),
  maxSpins: WheelPositiveLimitSchema.optional(),
  limitPeriodSeconds: WheelPositiveLimitSchema.optional(),
  activeFrom: NullableDateTimeSchema.optional(),
  activeUntil: NullableDateTimeSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 1, { message: "Wheel settings update cannot be empty" }).superRefine((settings, context) => {
  if (settings.activeFrom !== undefined && settings.activeFrom !== null && settings.activeUntil !== undefined && settings.activeUntil !== null && new Date(settings.activeUntil).getTime() <= new Date(settings.activeFrom).getTime()) {
    context.addIssue({ code: "custom", message: "Wheel active period is invalid", path: ["activeUntil"] });
  }
});
export type WheelSettingsUpdateRequest = z.infer<typeof WheelSettingsUpdateRequestSchema>;

export const WheelPrizeUpdateRequestSchema = z.object({
  expectedVersion: IdSchema,
  name: TextSchema.optional(),
  description: z.string().max(2048).optional(),
  type: WheelPrizeTypeSchema.optional(),
  value: UnitSchema.optional(),
  weight: z.number().int().min(0).max(MAX_POSTGRES_INTEGER).optional(),
  isVisible: z.boolean().optional(),
  activeFrom: NullableDateTimeSchema.optional(),
  activeUntil: NullableDateTimeSchema.optional(),
  sortOrder: UnitSchema.optional()
}).strict();
export type WheelPrizeUpdateRequest = z.infer<typeof WheelPrizeUpdateRequestSchema>;

export const QuestUnitSchema = z.enum(["order", "minor_units"]);
export type QuestUnit = z.infer<typeof QuestUnitSchema>;
export const QuestRewardTypeSchema = z.enum(["xp", "coal"]);
export type QuestRewardType = z.infer<typeof QuestRewardTypeSchema>;
export const QuestStatusSchema = z.enum(["active", "earned"]);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;

const QuestCodeSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u);
const QuestTitleSchema = z.string().trim().min(1).max(160);
const QuestDescriptionSchema = z.string().trim().max(2048);
const QuestPositiveUnitSchema = z.number().int().min(1).max(MAX_POSTGRES_INTEGER).refine(Number.isSafeInteger);

function validateQuestPeriod<T extends { activeFrom?: string | null | undefined; activeUntil?: string | null | undefined }>(quest: T, context: z.RefinementCtx): void {
  if (quest.activeFrom !== undefined && quest.activeFrom !== null && quest.activeUntil !== undefined && quest.activeUntil !== null && new Date(quest.activeUntil).getTime() <= new Date(quest.activeFrom).getTime()) {
    context.addIssue({ code: "custom", message: "Quest active period is invalid", path: ["activeUntil"] });
  }
}

export const QuestDefinitionSchema = z
  .object({
    id: IdSchema,
    code: QuestCodeSchema,
    title: QuestTitleSchema,
    description: QuestDescriptionSchema,
    goal: QuestPositiveUnitSchema,
    unit: QuestUnitSchema,
    rewardType: QuestRewardTypeSchema,
    rewardValue: QuestPositiveUnitSchema,
    isVisible: z.boolean(),
    activeFrom: NullableDateTimeSchema,
    activeUntil: NullableDateTimeSchema,
    sortOrder: UnitSchema,
    version: z.number().int().positive().max(MAX_POSTGRES_INTEGER)
  })
  .strict()
  .superRefine(validateQuestPeriod);
export type QuestDefinition = z.infer<typeof QuestDefinitionSchema>;

export const QuestRewardClaimSchema = z.object({
  id: IdSchema,
  status: z.enum(["pending", "succeeded", "reconciliation_required"]),
  rewardType: QuestRewardTypeSchema,
  rewardValue: UnitSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema
}).strict();
export type QuestRewardClaim = z.infer<typeof QuestRewardClaimSchema>;

export const QuestProgressSchema = z.object({
  quest: QuestDefinitionSchema,
  progress: UnitSchema,
  status: QuestStatusSchema,
  rewardClaim: QuestRewardClaimSchema.nullable(),
  updatedAt: DateTimeSchema
}).strict().superRefine((value, context) => {
  if (value.progress > value.quest.goal) {
    context.addIssue({ code: "custom", message: "Quest progress cannot exceed goal", path: ["progress"] });
  }
  if (value.status === "earned" && value.progress !== value.quest.goal) {
    context.addIssue({ code: "custom", message: "Earned quest must be at goal", path: ["progress"] });
  }
});
export type QuestProgress = z.infer<typeof QuestProgressSchema>;

export const QuestStateResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), quests: z.array(QuestProgressSchema).max(50) }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_configured", "reconciliation_required"]) }).strict()
]);
export type QuestStateResponse = z.infer<typeof QuestStateResponseSchema>;

export const AdminWheelResponseSchema = z.object({
  status: z.literal("confirmed"),
  settings: WheelSettingsSchema,
  prizes: z.array(WheelPrizeSchema).max(M14_WHEEL_MAX_PRIZES)
}).strict();
export type AdminWheelResponse = z.infer<typeof AdminWheelResponseSchema>;

export const AdminQuestsResponseSchema = z.object({
  status: z.literal("confirmed"),
  quests: z.array(QuestDefinitionSchema).max(50)
}).strict();
export type AdminQuestsResponse = z.infer<typeof AdminQuestsResponseSchema>;

export const QuestDefinitionCreateRequestSchema = z
  .object({
    code: QuestCodeSchema,
    title: QuestTitleSchema,
    description: QuestDescriptionSchema.default(""),
    goal: QuestPositiveUnitSchema,
    unit: QuestUnitSchema,
    rewardType: QuestRewardTypeSchema,
    rewardValue: QuestPositiveUnitSchema,
    isVisible: z.boolean().default(true),
    activeFrom: NullableDateTimeSchema.default(null),
    activeUntil: NullableDateTimeSchema.default(null),
    sortOrder: UnitSchema.default(0)
  })
  .strict()
  .superRefine(validateQuestPeriod);
export type QuestDefinitionCreateRequest = z.infer<typeof QuestDefinitionCreateRequestSchema>;

export const QuestDefinitionUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive().max(MAX_POSTGRES_INTEGER).refine(Number.isSafeInteger),
  title: QuestTitleSchema.optional(),
  description: QuestDescriptionSchema.optional(),
  goal: QuestPositiveUnitSchema.optional(),
  unit: QuestUnitSchema.optional(),
  rewardType: QuestRewardTypeSchema.optional(),
  rewardValue: QuestPositiveUnitSchema.optional(),
  isVisible: z.boolean().optional(),
  activeFrom: NullableDateTimeSchema.optional(),
  activeUntil: NullableDateTimeSchema.optional(),
  sortOrder: UnitSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 1, { message: "Quest update cannot be empty" }).superRefine(validateQuestPeriod);
export type QuestDefinitionUpdateRequest = z.infer<typeof QuestDefinitionUpdateRequestSchema>;
