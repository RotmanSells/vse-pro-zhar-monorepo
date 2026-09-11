import { z } from "zod";

const StaffIdSchema = z.number().int().positive().max(2_147_483_647);

export const StaffProfileSchema = z
  .object({
    id: StaffIdSchema,
    login: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(160)
  })
  .strict();
export type StaffProfile = z.infer<typeof StaffProfileSchema>;

export const AdminAuthLoginRequestSchema = z
  .object({
    login: z.string().trim().min(1).max(80),
    password: z.string().min(12).max(128)
  })
  .strict();
export type AdminAuthLoginRequest = z.infer<typeof AdminAuthLoginRequestSchema>;

export const AdminAuthSessionSchema = z
  .object({ expiresAt: z.iso.datetime({ offset: true }) })
  .strict();
export type AdminAuthSession = z.infer<typeof AdminAuthSessionSchema>;

export const AdminAuthLoginResponseSchema = z
  .object({
    staff: StaffProfileSchema,
    session: AdminAuthSessionSchema
  })
  .strict();
export type AdminAuthLoginResponse = z.infer<typeof AdminAuthLoginResponseSchema>;

export const AdminAuthMeResponseSchema = AdminAuthLoginResponseSchema;
export type AdminAuthMeResponse = AdminAuthLoginResponse;

export const AdminAuthLogoutResponseSchema = z
  .object({ loggedOut: z.literal(true) })
  .strict();
export type AdminAuthLogoutResponse = z.infer<typeof AdminAuthLogoutResponseSchema>;

export const AdminAuthStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unknown") }).strict(),
  z.object({ status: z.literal("loading") }).strict(),
  z.object({ status: z.literal("anonymous") }).strict(),
  z.object({ status: z.literal("authenticated"), staff: StaffProfileSchema }).strict(),
  z.object({ status: z.literal("error"), message: z.string().trim().min(1) }).strict()
]);
export type AdminAuthState = z.infer<typeof AdminAuthStateSchema>;
