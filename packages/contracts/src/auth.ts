import { z } from "zod";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

export const CustomerPhoneInputSchema = z.string().trim().min(1).max(64);
export const CustomerNameSchema = z.string().trim().min(1).max(160);

export const CustomerBirthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= "1900-01-01" &&
      value <= new Date().toISOString().slice(0, 10)
    );
  }, "Birth date must be a valid non-future date");

export type CustomerBirthDate = z.infer<typeof CustomerBirthDateSchema>;

export const CustomerIdentifyRequestSchema = z
  .object({
    phone: CustomerPhoneInputSchema,
    name: CustomerNameSchema.optional(),
    birthDate: CustomerBirthDateSchema.nullable().optional()
  })
  .strict();
export type CustomerIdentifyRequest = z.input<
  typeof CustomerIdentifyRequestSchema
>;

export const CustomerProfileSchema = z
  .object({
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/u),
    name: CustomerNameSchema,
    birthDate: CustomerBirthDateSchema.nullable()
  })
  .strict();
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

export const CustomerSessionSchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }),
    token: z.string().min(32).nullable()
  })
  .strict();
export type CustomerSession = z.infer<typeof CustomerSessionSchema>;

export const CustomerIdentifyResponseSchema = z
  .object({
    customer: CustomerProfileSchema,
    session: CustomerSessionSchema
  })
  .strict();
export type CustomerIdentifyResponse = z.infer<
  typeof CustomerIdentifyResponseSchema
>;

export const CustomerMeResponseSchema = z
  .object({
    customer: CustomerProfileSchema,
    session: CustomerSessionSchema.omit({ token: true }).strict()
  })
  .strict();
export type CustomerMeResponse = z.infer<typeof CustomerMeResponseSchema>;

export const CustomerLogoutResponseSchema = z
  .object({ loggedOut: z.literal(true) })
  .strict();
export type CustomerLogoutResponse = z.infer<
  typeof CustomerLogoutResponseSchema
>;

export const AuthStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unknown") }).strict(),
  z.object({ status: z.literal("loading") }).strict(),
  z.object({ status: z.literal("anonymous") }).strict(),
  z.object({ status: z.literal("identified"), customer: CustomerProfileSchema }).strict(),
  z.object({ status: z.literal("error"), message: z.string().min(1) }).strict()
]);
export type AuthState = z.infer<typeof AuthStateSchema>;

export const PendingAddActionSchema = z
  .object({
    productId: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
    quantity: z.number().int().min(1).max(99)
  })
  .strict();
export type PendingAddAction = z.infer<typeof PendingAddActionSchema>;
