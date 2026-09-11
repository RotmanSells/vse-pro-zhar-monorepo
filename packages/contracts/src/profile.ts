import { z } from "zod";

import {
  CustomerProfileSchema
} from "./auth.js";
import {
  LoyaltySummaryResponseSchema
} from "./loyalty.js";
import {
  OrderItemSchema,
  OrderSummarySchema
} from "./orders.js";

export const PROFILE_RECENT_ORDERS_LIMIT = 5;
export const MAX_PROFILE_ORDER_COUNT = 2_147_483_647;
export const MAX_PROFILE_MILESTONE_REMAINING = 2_147_483_647;

const ProfileSafeTextSchema = z.string().trim().min(1).max(160);
const ProfileUnitSchema = z.enum(["xp", "orders"]);
const ProfileMilestoneSourceSchema = z.enum(["loyalty_rank", "order_count"]);

export const CustomerProfileMilestoneSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    remaining: z
      .number()
      .int()
      .min(0)
      .max(MAX_PROFILE_MILESTONE_REMAINING)
      .refine(Number.isSafeInteger),
    unit: ProfileUnitSchema,
    source: ProfileMilestoneSourceSchema
  })
  .strict();
export type CustomerProfileMilestone = z.infer<typeof CustomerProfileMilestoneSchema>;

export const CustomerProfileStatsSchema = z
  .object({
    orderCount: z
      .number()
      .int()
      .min(0)
      .max(MAX_PROFILE_ORDER_COUNT)
      .refine(Number.isSafeInteger),
    favoriteProduct: ProfileSafeTextSchema.nullable(),
    nextMilestone: CustomerProfileMilestoneSchema.nullable()
  })
  .strict();
export type CustomerProfileStats = z.infer<typeof CustomerProfileStatsSchema>;

export const CustomerProfileSettingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), enabled: z.boolean() }).strict(),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum([
      "native_push_contract_pending",
      "email_consent_contract_pending",
      "theme_contract_pending"
    ])
  }).strict()
]);
export type CustomerProfileSetting = z.infer<typeof CustomerProfileSettingSchema>;

export const CustomerProfileSettingsSchema = z
  .object({
    pushNotifications: CustomerProfileSettingSchema,
    emailSubscription: CustomerProfileSettingSchema,
    darkTheme: CustomerProfileSettingSchema
  })
  .strict();
export type CustomerProfileSettings = z.infer<typeof CustomerProfileSettingsSchema>;

export const CustomerProfileRecentOrderSchema = OrderSummarySchema.extend({
  items: z.array(OrderItemSchema).min(1).max(100)
}).strict();
export type CustomerProfileRecentOrder = z.infer<typeof CustomerProfileRecentOrderSchema>;

export const CustomerProfileResponseSchema = z
  .object({
    customer: CustomerProfileSchema,
    stats: CustomerProfileStatsSchema,
    loyalty: LoyaltySummaryResponseSchema,
    settings: CustomerProfileSettingsSchema,
    recentOrders: z.array(CustomerProfileRecentOrderSchema).max(PROFILE_RECENT_ORDERS_LIMIT)
  })
  .strict();
export type CustomerProfileResponse = z.infer<typeof CustomerProfileResponseSchema>;
