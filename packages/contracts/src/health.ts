import { z } from "zod";

export const EnvironmentSchema = z.enum(["development", "test", "production"]);
export type ApiEnvironment = z.infer<typeof EnvironmentSchema>;

export const HealthResponseSchema = z
  .object({
    service: z.literal("api"),
    status: z.literal("ok"),
    environment: EnvironmentSchema,
    timestamp: z.iso.datetime({ offset: true })
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CART_ITEM_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
  "PAYLOAD_TOO_LARGE",
  "AUTHENTICATION_ERROR",
  "FORBIDDEN",
  "RATE_LIMITED",
  "CHECKOUT_UNAVAILABLE",
  "CHECKOUT_STALE",
  "PICKUP_OPTION_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_NOT_ALLOWED",
  "PAYMENT_UNAVAILABLE",
  "PAYMENT_INVALID",
  "FULFILLMENT_RECOVERY_NOT_ALLOWED",
  "CANCELLATION_NOT_ALLOWED",
  "ORDER_ALREADY_CANCELED",
  "REFUND_PENDING",
  "REFUND_RECONCILIATION_REQUIRED",
  "LOYALTY_UNAVAILABLE",
  "LOYALTY_RECONCILIATION_REQUIRED",
  "LOYALTY_REDEMPTION_UNAVAILABLE",
  "LOYALTY_INSUFFICIENT_BALANCE",
  "LOYALTY_IDEMPOTENCY_CONFLICT",
  "LOYALTY_INVALID_TRANSITION",
  "LOYALTY_REWARD_CONFLICT",
  "LOYALTY_REWARD_CODE_CONFLICT",
  "LOYALTY_REWARD_IDEMPOTENCY_CONFLICT",
  "LOYALTY_WHEEL_UNAVAILABLE",
  "LOYALTY_WHEEL_PRIZE_LIMIT",
  "LOYALTY_WHEEL_PRIZE_CONFLICT",
  "LOYALTY_WHEEL_PRIZE_IDEMPOTENCY_CONFLICT",
  "LOYALTY_WHEEL_COOLDOWN",
  "LOYALTY_WHEEL_LIMIT_REACHED",
  "LOYALTY_WHEEL_NOT_ELIGIBLE",
  "LOYALTY_WHEEL_SETTINGS_CONFLICT",
  "LOYALTY_WHEEL_SETTINGS_IDEMPOTENCY_CONFLICT",
  "LOYALTY_QUEST_UNAVAILABLE",
  "LOYALTY_QUEST_CONFLICT",
  "LOYALTY_QUEST_CODE_CONFLICT",
  "LOYALTY_QUEST_IDEMPOTENCY_CONFLICT",
  "COMMUNICATION_DRAFT_CONFLICT",
  "COMMUNICATION_IDEMPOTENCY_CONFLICT",
  "COMMUNICATION_UNAVAILABLE",
  "NOTIFICATION_UNAVAILABLE",
  "NOTIFICATION_DEVICE_CONFLICT",
  "NOTIFICATION_PUSH_CONFLICT",
  "NOTIFICATION_PUSH_DISABLED",
  "NOTIFICATION_PUSH_NO_DEVICE",
  "CATALOG_CATEGORY_CONFLICT",
  "CATALOG_CATEGORY_IDEMPOTENCY_CONFLICT",
  "INTERNAL_ERROR"
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().trim().min(1),
        requestId: z.string().trim().min(1)
      })
      .strict()
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;
