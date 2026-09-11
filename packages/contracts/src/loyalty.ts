import { z } from "zod";

import { CartMoneyMinorSchema } from "./cart.js";

export const MAX_LOYALTY_UNITS = 2_147_483_647;
export const LOYALTY_EARN_RULE_VERSION = 1;
export const LOYALTY_XP_PER_RUBLE = 1;
export const LOYALTY_RUBLES_PER_COAL = 100;

const IdSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_LOYALTY_UNITS)
  .refine(Number.isSafeInteger);
const UnitSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_LOYALTY_UNITS)
  .refine(Number.isSafeInteger);
const DeltaSchema = z
  .number()
  .int()
  .min(-MAX_LOYALTY_UNITS)
  .max(MAX_LOYALTY_UNITS)
  .refine(Number.isSafeInteger);
const DateTimeSchema = z.iso.datetime({ offset: true });
const SafeTextSchema = z.string().trim().min(1).max(240);

export const LoyaltyRankCodeSchema = z.enum(["spark", "heat", "flame", "volcano"]);
export type LoyaltyRankCode = z.infer<typeof LoyaltyRankCodeSchema>;

export const LoyaltyRankSchema = z
  .object({
    code: LoyaltyRankCodeSchema,
    name: z.string().trim().min(1).max(80),
    thresholdXp: UnitSchema,
    benefits: z.array(SafeTextSchema).max(20)
  })
  .strict();
export type LoyaltyRank = z.infer<typeof LoyaltyRankSchema>;
export const RankSummarySchema = LoyaltyRankSchema;
export type RankSummary = LoyaltyRank;

export const LoyaltyRankProgressSchema = z
  .object({
    nextRank: RankSummarySchema.nullable(),
    xpIntoCurrentRank: UnitSchema,
    xpToNextRank: UnitSchema,
    progressPercent: z.number().int().min(0).max(100),
    isMaxRank: z.boolean()
  })
  .strict()
  .superRefine((progress, context) => addRankProgressIssues(progress, context.addIssue));
export type LoyaltyRankProgress = z.infer<typeof LoyaltyRankProgressSchema>;

function addRankProgressIssues(
  progress: LoyaltyRankProgress,
  addIssue: (issue: { code: "custom"; message: string; path?: (string | number)[] }) => void
): void {
  if (progress.isMaxRank) {
    if (progress.nextRank !== null) {
      addIssue({ code: "custom", message: "Max rank cannot have a next rank", path: ["nextRank"] });
    }
    if (progress.xpToNextRank !== 0) {
      addIssue({ code: "custom", message: "Max rank must have no XP remaining", path: ["xpToNextRank"] });
    }
    if (progress.progressPercent !== 100) {
      addIssue({ code: "custom", message: "Max rank progress must be complete", path: ["progressPercent"] });
    }
    return;
  }
  if (progress.nextRank === null) {
    addIssue({ code: "custom", message: "Non-max rank must have a next rank", path: ["nextRank"] });
  }
  if (progress.xpToNextRank === 0) {
    addIssue({ code: "custom", message: "Non-max rank must have XP remaining", path: ["xpToNextRank"] });
  }
  if (progress.progressPercent >= 100) {
    addIssue({ code: "custom", message: "Non-max rank progress must be below 100", path: ["progressPercent"] });
  }
}

export const LoyaltySummarySchema = z
  .object({
    xp: UnitSchema,
    coalBalance: UnitSchema,
    rank: RankSummarySchema,
    ...LoyaltyRankProgressSchema.shape,
    version: z.number().int().min(0).max(MAX_LOYALTY_UNITS),
    updatedAt: DateTimeSchema
  })
  .strict()
  .superRefine((summary, context) => addRankProgressIssues(summary, context.addIssue));
export type LoyaltySummary = z.infer<typeof LoyaltySummarySchema>;

export const LoyaltyUnavailableReasonSchema = z.enum([
  "not_configured",
  "reconciliation_required"
]);
export type LoyaltyUnavailableReason = z.infer<typeof LoyaltyUnavailableReasonSchema>;

export const LoyaltySummaryResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), summary: LoyaltySummarySchema }).strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: LoyaltyUnavailableReasonSchema
    })
    .strict()
]);
export type LoyaltySummaryResponse = z.infer<typeof LoyaltySummaryResponseSchema>;

export const LoyaltyLedgerEntryTypeSchema = z.enum(["earned", "spent", "correction"]);
export type LoyaltyLedgerEntryType = z.infer<typeof LoyaltyLedgerEntryTypeSchema>;

export const LoyaltyLedgerSourceTypeSchema = z.enum([
  "completed_order",
  "redemption",
  "admin_correction",
  "wheel_spin",
  "quest_reward"
]);
export type LoyaltyLedgerSourceType = z.infer<typeof LoyaltyLedgerSourceTypeSchema>;

export const LoyaltyActorTypeSchema = z.enum(["system", "customer", "admin"]);
export type LoyaltyActorType = z.infer<typeof LoyaltyActorTypeSchema>;

export const LoyaltyLedgerEntrySchema = z
  .object({
    id: IdSchema,
    entryType: LoyaltyLedgerEntryTypeSchema,
    sourceType: LoyaltyLedgerSourceTypeSchema,
    sourceId: SafeTextSchema,
    sourceOrderId: IdSchema.nullable(),
    xpDelta: DeltaSchema,
    coalDelta: DeltaSchema,
    xpBalance: UnitSchema,
    coalBalance: UnitSchema,
    reason: SafeTextSchema,
    actorType: LoyaltyActorTypeSchema,
    actorId: IdSchema.nullable(),
    createdAt: DateTimeSchema
  })
  .strict();
export type LoyaltyLedgerEntry = z.infer<typeof LoyaltyLedgerEntrySchema>;

export const LoyaltyLedgerFilterTypeSchema = LoyaltyLedgerEntryTypeSchema;
export const LoyaltyLedgerQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
    entryType: LoyaltyLedgerFilterTypeSchema.optional()
  })
  .strict();
export type LoyaltyLedgerQuery = z.infer<typeof LoyaltyLedgerQuerySchema>;
export type LoyaltyLedgerQueryInput = z.input<typeof LoyaltyLedgerQuerySchema>;

export const LoyaltyLedgerResponseSchema = z
  .object({
    status: z.enum(["confirmed", "unavailable"]),
    entries: z.array(LoyaltyLedgerEntrySchema).max(100),
    pagination: z
      .object({
        limit: z.number().int().min(1).max(100),
        offset: z.number().int().min(0),
        total: z.number().int().min(0),
        hasNext: z.boolean()
      })
      .strict(),
    unavailableReason: LoyaltyUnavailableReasonSchema.optional()
  })
  .strict()
  .superRefine((response, context) => {
    if (response.status === "confirmed" && response.unavailableReason !== undefined) {
      context.addIssue({ code: "custom", message: "Confirmed ledger cannot have unavailable reason" });
    }
    if (response.status === "unavailable" && response.unavailableReason === undefined) {
      context.addIssue({ code: "custom", message: "Unavailable ledger must have a reason" });
    }
  });
export type LoyaltyLedgerResponse = z.infer<typeof LoyaltyLedgerResponseSchema>;

export const RewardDefinitionSchema = z
  .object({
    id: IdSchema,
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(160),
    description: z.string().max(2048),
    costCoal: z.number().int().positive().max(MAX_LOYALTY_UNITS),
    rewardType: z.literal("fixed_discount"),
    fulfillmentTarget: z
      .object({
        type: z.literal("fixed_discount"),
        discountMinor: CartMoneyMinorSchema.positive().max(MAX_LOYALTY_UNITS)
      })
      .strict(),
    isVisible: z.boolean(),
    isArchived: z.boolean(),
    activeFrom: DateTimeSchema.nullable(),
    activeUntil: DateTimeSchema.nullable(),
    sortOrder: z.number().int().min(0).max(MAX_LOYALTY_UNITS),
    version: z.number().int().positive().max(MAX_LOYALTY_UNITS),
    perCustomerUsageLimit: z.number().int().positive().max(MAX_LOYALTY_UNITS).nullable(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema
  })
  .strict()
  .superRefine((reward, context) => {
    if (reward.activeFrom !== null && reward.activeUntil !== null && reward.activeUntil <= reward.activeFrom) {
      context.addIssue({ code: "custom", message: "Reward active period is invalid", path: ["activeUntil"] });
    }
  });
export type RewardDefinition = z.infer<typeof RewardDefinitionSchema>;

export const LoyaltyRewardTypeSchema = z.literal("fixed_discount");
export type LoyaltyRewardType = z.infer<typeof LoyaltyRewardTypeSchema>;

export const LoyaltyRewardFulfillmentTargetSchema = z
  .object({
    type: LoyaltyRewardTypeSchema,
    discountMinor: CartMoneyMinorSchema.positive().max(MAX_LOYALTY_UNITS)
  })
  .strict();
export type LoyaltyRewardFulfillmentTarget = z.infer<typeof LoyaltyRewardFulfillmentTargetSchema>;

const RewardCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u);
const RewardNameSchema = z.string().trim().min(1).max(160);
const RewardDescriptionSchema = z.string().max(2048).default("");
const RewardPeriodSchema = z.string().datetime({ offset: true }).nullable().default(null);
const RewardSortOrderSchema = z.number().int().min(0).max(MAX_LOYALTY_UNITS).refine(Number.isSafeInteger).default(0);
const RewardUsageLimitSchema = z.number().int().positive().max(MAX_LOYALTY_UNITS).refine(Number.isSafeInteger).nullable().default(1);

export const LoyaltyRewardCreateRequestSchema = z
  .object({
    code: RewardCodeSchema,
    name: RewardNameSchema,
    description: RewardDescriptionSchema,
    costCoal: z.number().int().positive().max(MAX_LOYALTY_UNITS).refine(Number.isSafeInteger),
    rewardType: LoyaltyRewardTypeSchema,
    fulfillmentTarget: LoyaltyRewardFulfillmentTargetSchema,
    isVisible: z.boolean().default(true),
    activeFrom: RewardPeriodSchema,
    activeUntil: RewardPeriodSchema,
    sortOrder: RewardSortOrderSchema,
    perCustomerUsageLimit: RewardUsageLimitSchema
  })
  .strict()
  .superRefine((reward, context) => {
    if (reward.fulfillmentTarget.type !== reward.rewardType) {
      context.addIssue({ code: "custom", message: "Reward target type must match reward type", path: ["fulfillmentTarget", "type"] });
    }
    if (reward.activeFrom !== null && reward.activeUntil !== null && reward.activeUntil <= reward.activeFrom) {
      context.addIssue({ code: "custom", message: "Reward active period is invalid", path: ["activeUntil"] });
    }
  });
export type LoyaltyRewardCreateRequest = z.infer<typeof LoyaltyRewardCreateRequestSchema>;

export const LoyaltyRewardUpdateRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive().max(MAX_LOYALTY_UNITS).refine(Number.isSafeInteger),
    name: RewardNameSchema.optional(),
    description: z.string().max(2048).optional(),
    costCoal: z.number().int().positive().max(MAX_LOYALTY_UNITS).refine(Number.isSafeInteger).optional(),
    fulfillmentTarget: LoyaltyRewardFulfillmentTargetSchema.optional(),
    isVisible: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    activeFrom: z.string().datetime({ offset: true }).nullable().optional(),
    activeUntil: z.string().datetime({ offset: true }).nullable().optional(),
    sortOrder: z.number().int().min(0).max(MAX_LOYALTY_UNITS).refine(Number.isSafeInteger).optional(),
    perCustomerUsageLimit: z.number().int().positive().max(MAX_LOYALTY_UNITS).refine(Number.isSafeInteger).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Reward update cannot be empty" })
  .superRefine((reward, context) => {
    if (reward.isArchived === true && reward.isVisible === true) {
      context.addIssue({ code: "custom", message: "Archived reward cannot be visible", path: ["isVisible"] });
    }
    if (reward.activeFrom !== undefined && reward.activeUntil !== undefined && reward.activeFrom !== null && reward.activeUntil !== null && reward.activeUntil <= reward.activeFrom) {
      context.addIssue({ code: "custom", message: "Reward active period is invalid", path: ["activeUntil"] });
    }
  });
export type LoyaltyRewardUpdateRequest = z.infer<typeof LoyaltyRewardUpdateRequestSchema>;

export const LoyaltyRewardsResponseSchema = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("confirmed"), rewards: z.array(RewardDefinitionSchema).max(100) }).strict(),
    z.object({ status: z.literal("unavailable"), reason: LoyaltyUnavailableReasonSchema }).strict()
  ]);
export type LoyaltyRewardsResponse = z.infer<typeof LoyaltyRewardsResponseSchema>;

export const AdminLoyaltyRewardsResponseSchema = z.object({
  status: z.literal("confirmed"),
  rewards: z.array(RewardDefinitionSchema).max(100)
}).strict();
export type AdminLoyaltyRewardsResponse = z.infer<typeof AdminLoyaltyRewardsResponseSchema>;

export const RedemptionStatusSchema = z.enum([
  "pending",
  "succeeded",
  "canceled",
  "reconciliation_required"
]);
export type RedemptionStatus = z.infer<typeof RedemptionStatusSchema>;

export const RedemptionSummarySchema = z
  .object({
    id: IdSchema,
    rewardId: IdSchema,
    rewardCode: z.string().trim().min(1).max(80),
    rewardName: z.string().trim().min(1).max(160),
    costCoal: z.number().int().positive().max(MAX_LOYALTY_UNITS),
    rewardType: LoyaltyRewardTypeSchema,
    discountMinor: CartMoneyMinorSchema.positive().max(MAX_LOYALTY_UNITS),
    expiresAt: DateTimeSchema,
    status: RedemptionStatusSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema
  })
  .strict();
export type RedemptionSummary = z.infer<typeof RedemptionSummarySchema>;

export const LoyaltyRedemptionsResponseSchema = z
  .object({
    status: z.enum(["confirmed", "unavailable"]),
    redemptions: z.array(RedemptionSummarySchema).max(100),
    pagination: z.object({ limit: z.number().int().min(1).max(100), offset: z.number().int().min(0), total: z.number().int().min(0), hasNext: z.boolean() }).strict(),
    unavailableReason: LoyaltyUnavailableReasonSchema.optional()
  })
  .strict()
  .superRefine((response, context) => {
    if (response.status === "confirmed" && response.unavailableReason !== undefined) context.addIssue({ code: "custom", message: "Confirmed redemptions cannot have unavailable reason" });
    if (response.status === "unavailable" && response.unavailableReason === undefined) context.addIssue({ code: "custom", message: "Unavailable redemptions must have a reason" });
  });
export type LoyaltyRedemptionsResponse = z.infer<typeof LoyaltyRedemptionsResponseSchema>;

export const LoyaltyRedemptionResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), redemption: RedemptionSummarySchema, coalBalance: UnitSchema }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["redemption_disabled", "reconciliation_required"]) }).strict()
]);
export type LoyaltyRedemptionResponse = z.infer<typeof LoyaltyRedemptionResponseSchema>;

export const LoyaltyRedemptionDetailResponseSchema = LoyaltyRedemptionResponseSchema;
export type LoyaltyRedemptionDetailResponse = z.infer<typeof LoyaltyRedemptionDetailResponseSchema>;

export const LoyaltyEarnRuleSchema = z
  .object({
    version: z.literal(LOYALTY_EARN_RULE_VERSION),
    xpPerRuble: z.literal(LOYALTY_XP_PER_RUBLE),
    rublesPerCoal: z.literal(LOYALTY_RUBLES_PER_COAL),
    redemptionEnabled: z.boolean(),
    expires: z.boolean()
  })
  .strict();
export type LoyaltyEarnRule = z.infer<typeof LoyaltyEarnRuleSchema>;

export const AdminLoyaltyCustomerSchema = z
  .object({
    id: IdSchema,
    name: z.string().trim().min(1).max(160),
    phoneMasked: z.string().trim().min(1).max(32)
  })
  .strict();
export type AdminLoyaltyCustomer = z.infer<typeof AdminLoyaltyCustomerSchema>;

export const AdminLoyaltyLedgerEntrySchema = LoyaltyLedgerEntrySchema.extend({
  customer: AdminLoyaltyCustomerSchema
}).strict();
export type AdminLoyaltyLedgerEntry = z.infer<typeof AdminLoyaltyLedgerEntrySchema>;

export const AdminLoyaltyLedgerResponseSchema = z
  .object({
    status: z.enum(["confirmed", "unavailable"]),
    entries: z.array(AdminLoyaltyLedgerEntrySchema).max(100),
    pagination: z
      .object({
        limit: z.number().int().min(1).max(100),
        offset: z.number().int().min(0),
        total: z.number().int().min(0),
        hasNext: z.boolean()
      })
      .strict(),
    rule: LoyaltyEarnRuleSchema,
    unavailableReason: LoyaltyUnavailableReasonSchema.optional()
  })
  .strict()
  .superRefine((response, context) => {
    if (response.status === "confirmed" && response.unavailableReason !== undefined) {
      context.addIssue({ code: "custom", message: "Confirmed ledger cannot have unavailable reason" });
    }
    if (response.status === "unavailable" && response.unavailableReason === undefined) {
      context.addIssue({ code: "custom", message: "Unavailable ledger must have a reason" });
    }
  });
export type AdminLoyaltyLedgerResponse = z.infer<typeof AdminLoyaltyLedgerResponseSchema>;

export const AdminLoyaltyQuerySchema = LoyaltyLedgerQuerySchema.extend({
  customerId: IdSchema.optional(),
  orderId: IdSchema.optional()
}).strict();
export type AdminLoyaltyQuery = z.infer<typeof AdminLoyaltyQuerySchema>;
export type AdminLoyaltyQueryInput = z.input<typeof AdminLoyaltyQuerySchema>;

export const AdminLoyaltySummarySchema = z
  .object({
    customer: AdminLoyaltyCustomerSchema,
    summary: LoyaltySummaryResponseSchema
  })
  .strict();
export type AdminLoyaltySummary = z.infer<typeof AdminLoyaltySummarySchema>;

export const AdminLoyaltySummariesResponseSchema = z
  .object({
    status: z.enum(["confirmed", "unavailable"]),
    customers: z.array(AdminLoyaltySummarySchema).max(100),
    pagination: z
      .object({
        limit: z.number().int().min(1).max(100),
        offset: z.number().int().min(0),
        total: z.number().int().min(0),
        hasNext: z.boolean()
      })
      .strict(),
    rule: LoyaltyEarnRuleSchema,
    unavailableReason: LoyaltyUnavailableReasonSchema.optional()
  })
  .strict();
export type AdminLoyaltySummariesResponse = z.infer<typeof AdminLoyaltySummariesResponseSchema>;

export const LoyaltyRedemptionRequestSchema = z
  .object({
    rewardId: IdSchema
  })
  .strict();
export type LoyaltyRedemptionRequest = z.infer<typeof LoyaltyRedemptionRequestSchema>;

export const LoyaltyRedemptionUnavailableResponseSchema = z
  .object({
    status: z.literal("unavailable"),
    reason: z.literal("redemption_disabled")
  })
  .strict();
export type LoyaltyRedemptionUnavailableResponse = z.infer<typeof LoyaltyRedemptionUnavailableResponseSchema>;

export const LoyaltyLedgerSourceOrderTotalSchema = CartMoneyMinorSchema;
