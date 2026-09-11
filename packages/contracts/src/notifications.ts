import { z } from "zod";

const IdSchema = z.number().int().positive().max(2_147_483_647);
const DateTimeSchema = z.iso.datetime({ offset: true });

export const CustomerNotificationPlatformSchema = z.enum(["ios", "android"]);
export type CustomerNotificationPlatform = z.infer<typeof CustomerNotificationPlatformSchema>;

export const CustomerNotificationProviderSchema = z.literal("expo");

export const CustomerNotificationDeviceSchema = z.object({
  id: IdSchema,
  provider: CustomerNotificationProviderSchema,
  platform: CustomerNotificationPlatformSchema,
  token: z.string().trim().min(1).max(512),
  enabled: z.boolean(),
  lastSeenAt: DateTimeSchema
}).strict();
export type CustomerNotificationDevice = z.infer<typeof CustomerNotificationDeviceSchema>;

export const CustomerNotificationDeviceRegisterRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(255),
  provider: CustomerNotificationProviderSchema,
  platform: CustomerNotificationPlatformSchema,
  token: z.string().trim().min(1).max(512)
}).strict();
export type CustomerNotificationDeviceRegisterRequest = z.infer<typeof CustomerNotificationDeviceRegisterRequestSchema>;

export const CustomerNotificationDeviceResponseSchema = z.object({
  status: z.literal("confirmed"),
  device: CustomerNotificationDeviceSchema
}).strict();
export type CustomerNotificationDeviceResponse = z.infer<typeof CustomerNotificationDeviceResponseSchema>;

export const CustomerNotificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  updatedAt: DateTimeSchema
}).strict();
export type CustomerNotificationPreferences = z.infer<typeof CustomerNotificationPreferencesSchema>;

export const CustomerNotificationPreferencesResponseSchema = z.object({
  status: z.literal("confirmed"),
  preferences: CustomerNotificationPreferencesSchema
}).strict();
export type CustomerNotificationPreferencesResponse = z.infer<typeof CustomerNotificationPreferencesResponseSchema>;

export const CustomerNotificationPreferencesUpdateRequestSchema = z.object({
  pushEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional()
}).strict().refine((value) => value.pushEnabled !== undefined || value.smsEnabled !== undefined, "At least one preference is required");
export type CustomerNotificationPreferencesUpdateRequest = z.infer<typeof CustomerNotificationPreferencesUpdateRequestSchema>;

export const CustomerNotificationDeviceListResponseSchema = z.object({
  status: z.literal("confirmed"),
  devices: z.array(CustomerNotificationDeviceSchema).max(10)
}).strict();
export type CustomerNotificationDeviceListResponse = z.infer<typeof CustomerNotificationDeviceListResponseSchema>;

export const CustomerNotificationDeviceRevokeResponseSchema = z.object({
  status: z.literal("confirmed"),
  revoked: z.boolean()
}).strict();
export type CustomerNotificationDeviceRevokeResponse = z.infer<typeof CustomerNotificationDeviceRevokeResponseSchema>;
