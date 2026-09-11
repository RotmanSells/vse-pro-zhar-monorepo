import { z } from "zod";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_SEGMENT_DAYS = 3_650;
const MAX_SEGMENT_MONEY_MINOR = 1_000_000_000;
const DateTimeSchema = z.iso.datetime({ offset: true });
const IdSchema = z.number().int().positive().max(MAX_POSTGRES_INTEGER);
const NonNegativeIntegerSchema = z.number().int().min(0).max(MAX_POSTGRES_INTEGER);
const SegmentTextSchema = z.string().trim().min(1).max(240);

export const ADMIN_SEGMENT_TIMEZONE = "Europe/Moscow" as const;
export const ADMIN_SEGMENT_PREVIEW_LIMIT = 50;
export const ADMIN_SEGMENT_CODES = [
  "sleeping",
  "one_timer",
  "churned",
  "newbies",
  "regulars",
  "vip",
  "big_spenders",
  "coal_rich",
  "at_risk"
] as const;

export const AdminSegmentCodeSchema = z.enum(ADMIN_SEGMENT_CODES);
export type AdminSegmentCode = z.infer<typeof AdminSegmentCodeSchema>;

export const AdminSegmentCriterionMetricSchema = z.enum([
  "orders",
  "spend",
  "inactive_days",
  "active_days",
  "coal_balance",
  "average_check"
]);
export type AdminSegmentCriterionMetric = z.infer<typeof AdminSegmentCriterionMetricSchema>;

export const AdminSegmentCriterionOperatorSchema = z.enum(["eq", "gte", "lte", "gt", "lt"]);
export type AdminSegmentCriterionOperator = z.infer<typeof AdminSegmentCriterionOperatorSchema>;

const OrdersCriterionSchema = z.object({
  metric: z.literal("orders"),
  operator: AdminSegmentCriterionOperatorSchema,
  unit: z.literal("orders"),
  value: NonNegativeIntegerSchema
}).strict();

const SpendCriterionSchema = z.object({
  metric: z.literal("spend"),
  operator: AdminSegmentCriterionOperatorSchema,
  unit: z.literal("RUB_minor"),
  value: z.number().int().min(0).max(MAX_SEGMENT_MONEY_MINOR)
}).strict();

const InactiveDaysCriterionSchema = z.object({
  metric: z.literal("inactive_days"),
  operator: AdminSegmentCriterionOperatorSchema,
  unit: z.literal("days"),
  value: z.number().int().min(0).max(MAX_SEGMENT_DAYS)
}).strict();

const ActiveDaysCriterionSchema = z.object({
  metric: z.literal("active_days"),
  operator: AdminSegmentCriterionOperatorSchema,
  unit: z.literal("days"),
  value: z.number().int().min(0).max(MAX_SEGMENT_DAYS)
}).strict();

const CoalCriterionSchema = z.object({
  metric: z.literal("coal_balance"),
  operator: AdminSegmentCriterionOperatorSchema,
  unit: z.literal("coal"),
  value: NonNegativeIntegerSchema
}).strict();

const AverageCheckCriterionSchema = z.object({
  metric: z.literal("average_check"),
  operator: AdminSegmentCriterionOperatorSchema,
  unit: z.literal("RUB_minor"),
  value: z.number().int().min(0).max(MAX_SEGMENT_MONEY_MINOR)
}).strict();

export const AdminSegmentCriterionSchema = z.discriminatedUnion("metric", [
  OrdersCriterionSchema,
  SpendCriterionSchema,
  InactiveDaysCriterionSchema,
  ActiveDaysCriterionSchema,
  CoalCriterionSchema,
  AverageCheckCriterionSchema
]);
export type AdminSegmentCriterion = z.infer<typeof AdminSegmentCriterionSchema>;

export const AdminCustomSegmentCriteriaSchema = z
  .array(AdminSegmentCriterionSchema)
  .length(1)
  .superRefine((criteria, context) => {
    const criterion = criteria[0];
    if (criterion !== undefined && !["gte", "lte"].includes(criterion.operator)) {
      context.addIssue({ code: "custom", message: "Custom segments support only gte and lte operators", path: [0, "operator"] });
    }
  });
export type AdminCustomSegmentCriteria = z.infer<typeof AdminCustomSegmentCriteriaSchema>;

export const AdminSegmentBadgeSchema = z.object({
  tone: z.enum(["warning", "danger", "success", "info", "purple"]),
  label: z.string().trim().min(1).max(40)
}).strict();

export const AdminSegmentCountSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), count: NonNegativeIntegerSchema }).strict(),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum(["not_configured", "reconciliation_required"])
  }).strict()
]);
export type AdminSegmentCount = z.infer<typeof AdminSegmentCountSchema>;

export const AdminBuiltinSegmentDefinitionSchema = z.object({
  code: AdminSegmentCodeSchema,
  kind: z.literal("builtin"),
  icon: z.string().trim().min(1).max(16),
  title: SegmentTextSchema,
  description: SegmentTextSchema,
  badge: AdminSegmentBadgeSchema,
  criteria: z.array(AdminSegmentCriterionSchema).min(1).max(3),
  count: AdminSegmentCountSchema
}).strict();
export type AdminBuiltinSegmentDefinition = z.infer<typeof AdminBuiltinSegmentDefinitionSchema>;

export const AdminCustomSegmentDefinitionSchema = z.object({
  id: IdSchema,
  kind: z.literal("custom"),
  name: SegmentTextSchema,
  criteria: AdminCustomSegmentCriteriaSchema,
  status: z.enum(["active", "inactive"]),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  count: AdminSegmentCountSchema
}).strict();
export type AdminCustomSegmentDefinition = z.infer<typeof AdminCustomSegmentDefinitionSchema>;

export const AdminSegmentsResponseSchema = z.object({
  status: z.literal("confirmed"),
  timezone: z.literal(ADMIN_SEGMENT_TIMEZONE),
  asOf: DateTimeSchema,
  builtins: z.array(AdminBuiltinSegmentDefinitionSchema).length(9).readonly(),
  customSegments: z.array(AdminCustomSegmentDefinitionSchema).max(100).readonly(),
  customLifecycle: z.object({
    status: z.literal("unavailable"),
    reason: z.literal("owner_decision_required")
  }).strict()
}).strict().superRefine((response, context) => {
  const codes = response.builtins.map((segment) => segment.code);
  if (new Set(codes).size !== ADMIN_SEGMENT_CODES.length || ADMIN_SEGMENT_CODES.some((code) => !codes.includes(code))) {
    context.addIssue({ code: "custom", message: "Built-in segment definitions must contain each supported code exactly once", path: ["builtins"] });
  }
});
export type AdminSegmentsResponse = z.infer<typeof AdminSegmentsResponseSchema>;

export const AdminSegmentPreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_SEGMENT_PREVIEW_LIMIT).default(25),
  offset: z.coerce.number().int().min(0).max(MAX_POSTGRES_INTEGER).default(0)
}).strict();
export type AdminSegmentPreviewQuery = z.infer<typeof AdminSegmentPreviewQuerySchema>;
export type AdminSegmentPreviewQueryInput = z.input<typeof AdminSegmentPreviewQuerySchema>;

export const AdminSegmentPreviewCustomerSchema = z.object({
  id: IdSchema,
  name: SegmentTextSchema,
  phoneMasked: z.string().trim().min(1).max(32),
  orderCount: NonNegativeIntegerSchema,
  spentMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lastActivityAt: DateTimeSchema.nullable()
}).strict();
export type AdminSegmentPreviewCustomer = z.infer<typeof AdminSegmentPreviewCustomerSchema>;

const PreviewPaginationSchema = z.object({
  limit: z.number().int().min(1).max(ADMIN_SEGMENT_PREVIEW_LIMIT),
  offset: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
  total: NonNegativeIntegerSchema,
  hasNext: z.boolean()
}).strict();

export const AdminSegmentPreviewResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("confirmed"),
    segment: AdminBuiltinSegmentDefinitionSchema,
    customers: z.array(AdminSegmentPreviewCustomerSchema).max(ADMIN_SEGMENT_PREVIEW_LIMIT).readonly(),
    pagination: PreviewPaginationSchema,
    dataStatus: z.enum(["available", "empty"])
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    segment: AdminBuiltinSegmentDefinitionSchema,
    reason: z.enum(["not_configured", "reconciliation_required"]),
    customers: z.array(AdminSegmentPreviewCustomerSchema).max(0).readonly(),
    pagination: PreviewPaginationSchema
  }).strict()
]);
export type AdminSegmentPreviewResponse = z.infer<typeof AdminSegmentPreviewResponseSchema>;
