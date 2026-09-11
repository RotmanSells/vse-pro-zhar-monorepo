import { z } from "zod";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_PROMO_MONEY_MINOR = 1_000_000_000;
const MAX_PROMO_CODE_LENGTH = 32;

export const ADMIN_PROMO_TIMEZONE = "Europe/Moscow" as const;
export const ADMIN_PROMO_CURRENCY = "RUB" as const;
export const ADMIN_PROMO_PAGE_LIMIT = 50;
export const ADMIN_PROMO_CODE_MAX_LENGTH = MAX_PROMO_CODE_LENGTH;

const DateTimeSchema = z.iso.datetime({ offset: true });
const IdSchema = z.number().int().positive().max(MAX_POSTGRES_INTEGER);
const MoneyMinorSchema = z.number().int().min(0).max(MAX_PROMO_MONEY_MINOR);
const UsageLimitSchema = z.number().int().positive().max(MAX_POSTGRES_INTEGER);

export const AdminPromoTypeSchema = z.enum(["percent", "fixed"]);
export type AdminPromoType = z.infer<typeof AdminPromoTypeSchema>;

export const AdminPromoStatusSchema = z.enum(["active", "inactive", "archived"]);
export type AdminPromoStatus = z.infer<typeof AdminPromoStatusSchema>;

export const AdminPromoCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(MAX_PROMO_CODE_LENGTH)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/u);

const PromoDescriptionSchema = z.string().trim().max(240);

const PromoEconomicsShape = {
  description: PromoDescriptionSchema.default(""),
  type: AdminPromoTypeSchema,
  value: z.number().int().positive().max(MAX_PROMO_MONEY_MINOR),
  minimumOrderMinor: MoneyMinorSchema.default(0),
  currency: z.literal(ADMIN_PROMO_CURRENCY).default(ADMIN_PROMO_CURRENCY),
  activeFrom: DateTimeSchema.nullable().optional(),
  activeUntil: DateTimeSchema.nullable().optional(),
  globalUsageLimit: UsageLimitSchema.nullable().default(null),
  perCustomerUsageLimit: UsageLimitSchema.nullable().default(null)
} as const;

function validatePromoEconomics<T extends { type: AdminPromoType; value: number; activeFrom?: string | null | undefined; activeUntil?: string | null | undefined }>(input: T, context: z.RefinementCtx): void {
  if (input.type === "percent" && input.value > 100) {
    context.addIssue({ code: "custom", path: ["value"], message: "Percent promo value must be between 1 and 100" });
  }
  if (input.activeFrom !== undefined && input.activeFrom !== null && input.activeUntil !== undefined && input.activeUntil !== null && new Date(input.activeUntil).getTime() <= new Date(input.activeFrom).getTime()) {
    context.addIssue({ code: "custom", path: ["activeUntil"], message: "Promo active period is invalid" });
  }
}

export const AdminPromoCreateRequestSchema = z
  .object({
    code: AdminPromoCodeSchema,
    ...PromoEconomicsShape
  })
  .strict()
  .superRefine(validatePromoEconomics);
export type AdminPromoCreateRequest = z.infer<typeof AdminPromoCreateRequestSchema>;

export const AdminPromoUpdateRequestSchema = z
  .object({
    description: PromoDescriptionSchema.optional(),
    type: AdminPromoTypeSchema.optional(),
    value: z.number().int().positive().max(MAX_PROMO_MONEY_MINOR).optional(),
    minimumOrderMinor: MoneyMinorSchema.optional(),
    activeFrom: DateTimeSchema.optional(),
    activeUntil: DateTimeSchema.nullable().optional(),
    globalUsageLimit: UsageLimitSchema.nullable().optional(),
    perCustomerUsageLimit: UsageLimitSchema.nullable().optional(),
    isActive: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Promo update cannot be empty" })
  .superRefine((value, context) => {
    if (value.type !== undefined && value.value !== undefined) validatePromoEconomics(value as { type: AdminPromoType; value: number }, context);
    if (value.type === "percent" && value.value === undefined) {
      context.addIssue({ code: "custom", path: ["type"], message: "Promo type cannot change without value" });
    }
    if (value.activeFrom !== undefined && value.activeUntil !== undefined) {
      validatePromoEconomics(value as { type: AdminPromoType; value: number; activeFrom?: string | null; activeUntil?: string | null }, context);
    }
  });
export type AdminPromoUpdateRequest = z.infer<typeof AdminPromoUpdateRequestSchema>;

export const AdminPromoSchema = z
  .object({
    id: IdSchema,
    code: AdminPromoCodeSchema,
    description: PromoDescriptionSchema,
    type: AdminPromoTypeSchema,
    value: z.number().int().positive().max(MAX_PROMO_MONEY_MINOR),
    minimumOrderMinor: MoneyMinorSchema,
    currency: z.literal(ADMIN_PROMO_CURRENCY),
    activeFrom: DateTimeSchema,
    activeUntil: DateTimeSchema.nullable(),
    globalUsageLimit: UsageLimitSchema.nullable(),
    perCustomerUsageLimit: UsageLimitSchema.nullable(),
    stackingPolicy: z.literal("none"),
    status: AdminPromoStatusSchema,
    version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
    usageCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema
  })
  .strict()
  .superRefine((promo, context) => {
    if (promo.type === "percent" && promo.value > 100) context.addIssue({ code: "custom", path: ["value"], message: "Percent promo value must be between 1 and 100" });
    if (promo.activeUntil !== null && new Date(promo.activeUntil).getTime() <= new Date(promo.activeFrom).getTime()) context.addIssue({ code: "custom", path: ["activeUntil"], message: "Promo active period is invalid" });
  });
export type AdminPromo = z.infer<typeof AdminPromoSchema>;

export const AdminPromosQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(ADMIN_PROMO_PAGE_LIMIT).default(ADMIN_PROMO_PAGE_LIMIT),
    offset: z.coerce.number().int().min(0).max(MAX_POSTGRES_INTEGER).default(0),
    search: z.string().trim().max(80).default(""),
    status: AdminPromoStatusSchema.optional()
  })
  .strict();
export type AdminPromosQuery = z.infer<typeof AdminPromosQuerySchema>;
export type AdminPromosQueryInput = z.input<typeof AdminPromosQuerySchema>;

export const AdminPromosResponseSchema = z
  .object({
    status: z.literal("confirmed"),
    timezone: z.literal(ADMIN_PROMO_TIMEZONE),
    currency: z.literal(ADMIN_PROMO_CURRENCY),
    promos: z.array(AdminPromoSchema).max(ADMIN_PROMO_PAGE_LIMIT).readonly(),
    pagination: z.object({
      limit: z.number().int().min(1).max(ADMIN_PROMO_PAGE_LIMIT),
      offset: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
      total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      hasNext: z.boolean()
    }).strict(),
    customerCheckout: z.object({
      status: z.literal("unavailable"),
      reason: z.literal("owner_decision_required")
    }).strict()
  })
  .strict();
export type AdminPromosResponse = z.infer<typeof AdminPromosResponseSchema>;

export const AdminPromoResponseSchema = z.object({ promo: AdminPromoSchema }).strict();
export type AdminPromoResponse = z.infer<typeof AdminPromoResponseSchema>;

export const AdminPromoRedemptionStatusSchema = z.enum(["pending", "succeeded", "canceled", "reconciliation_required"]);
export type AdminPromoRedemptionStatus = z.infer<typeof AdminPromoRedemptionStatusSchema>;

export const AdminPromoRedemptionSchema = z.object({
  id: IdSchema,
  customerId: IdSchema.nullable(),
  orderId: IdSchema.nullable(),
  discountMinor: MoneyMinorSchema,
  preDiscountTotalMinor: MoneyMinorSchema,
  finalTotalMinor: MoneyMinorSchema,
  currency: z.literal(ADMIN_PROMO_CURRENCY),
  status: AdminPromoRedemptionStatusSchema,
  createdAt: DateTimeSchema
}).strict();
export type AdminPromoRedemption = z.infer<typeof AdminPromoRedemptionSchema>;

export const AdminPromoRedemptionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_PROMO_PAGE_LIMIT).default(ADMIN_PROMO_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).max(MAX_POSTGRES_INTEGER).default(0)
}).strict();
export type AdminPromoRedemptionsQuery = z.infer<typeof AdminPromoRedemptionsQuerySchema>;
export type AdminPromoRedemptionsQueryInput = z.input<typeof AdminPromoRedemptionsQuerySchema>;

export const AdminPromoRedemptionsResponseSchema = z.object({
  status: z.literal("confirmed"),
  promoId: IdSchema,
  promoCode: AdminPromoCodeSchema,
  redemptions: z.array(AdminPromoRedemptionSchema).max(ADMIN_PROMO_PAGE_LIMIT).readonly(),
  pagination: z.object({
    limit: z.number().int().min(1).max(ADMIN_PROMO_PAGE_LIMIT),
    offset: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
    total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    hasNext: z.boolean()
  }).strict()
}).strict();
export type AdminPromoRedemptionsResponse = z.infer<typeof AdminPromoRedemptionsResponseSchema>;
