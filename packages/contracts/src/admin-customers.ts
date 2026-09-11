import { z } from "zod";

const MAX_INTEGER = 2_147_483_647;
const SafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const IdSchema = z.number().int().positive().max(MAX_INTEGER);
const DateTimeSchema = z.iso.datetime({ offset: true });
const MaskedPhoneSchema = z.string().trim().min(1).max(32);

export const AdminCustomersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    offset: z.coerce.number().int().min(0).max(MAX_INTEGER).default(0),
    search: z.string().trim().max(160).default("")
  })
  .strict();
export type AdminCustomersQuery = z.infer<typeof AdminCustomersQuerySchema>;
export type AdminCustomersQueryInput = z.input<typeof AdminCustomersQuerySchema>;

export const AdminCustomerRankSchema = z.enum(["spark", "heat", "flame", "volcano"]);
export type AdminCustomerRank = z.infer<typeof AdminCustomerRankSchema>;

export const AdminCustomerRowSchema = z
  .object({
    id: IdSchema,
    name: z.string().trim().min(1).max(160),
    phoneMasked: MaskedPhoneSchema,
    orderCount: SafeIntegerSchema,
    spentMinor: SafeIntegerSchema,
    coalBalance: SafeIntegerSchema.nullable(),
    xp: SafeIntegerSchema.nullable(),
    rank: AdminCustomerRankSchema.nullable(),
    lastActivityAt: DateTimeSchema.nullable()
  })
  .strict();
export type AdminCustomerRow = z.infer<typeof AdminCustomerRowSchema>;

export const AdminCustomersUnavailableReasonSchema = z.enum([
  "not_configured",
  "reconciliation_required"
]);
export type AdminCustomersUnavailableReason = z.infer<typeof AdminCustomersUnavailableReasonSchema>;

export const AdminCustomersPaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(50),
    offset: z.number().int().min(0),
    total: z.number().int().min(0),
    hasNext: z.boolean()
  })
  .strict();

export const AdminCustomersResponseSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("confirmed"),
        customers: z.array(AdminCustomerRowSchema).max(50),
        pagination: AdminCustomersPaginationSchema
      })
      .strict(),
    z
      .object({
        status: z.literal("unavailable"),
        reason: AdminCustomersUnavailableReasonSchema,
        customers: z.array(AdminCustomerRowSchema).max(0),
        pagination: AdminCustomersPaginationSchema
      })
      .strict()
  ]);
export type AdminCustomersResponse = z.infer<typeof AdminCustomersResponseSchema>;
