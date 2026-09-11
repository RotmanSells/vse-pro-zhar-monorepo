import { z } from "zod";

import { CartMoneyMinorSchema } from "./cart.js";

const DateTimeSchema = z.iso.datetime({ offset: true });
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/u);
const SafeErrorCodeSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/u);
const ProviderRefundIdSchema = z.string().trim().min(1).max(160);

export const CancellationActorTypeSchema = z.enum(["customer", "admin"]);
export type CancellationActorType = z.infer<typeof CancellationActorTypeSchema>;

export const CancellationReasonCodeSchema = z.enum([
  "customer_requested",
  "admin_requested"
]);
export type CancellationReasonCode = z.infer<typeof CancellationReasonCodeSchema>;

export const RefundStatusSchema = z.enum([
  "pending",
  "succeeded",
  "canceled",
  "reconciliation_required"
]);
export type RefundStatus = z.infer<typeof RefundStatusSchema>;

export const CancellationSummarySchema = z
  .object({
    actorType: CancellationActorTypeSchema,
    reasonCode: CancellationReasonCodeSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema
  })
  .strict();
export type CancellationSummary = z.infer<typeof CancellationSummarySchema>;

export const RefundSummarySchema = z
  .object({
    status: RefundStatusSchema,
    amountMinor: CartMoneyMinorSchema,
    currency: CurrencySchema,
    attemptedAt: DateTimeSchema.nullable(),
    lastConfirmedAt: DateTimeSchema.nullable(),
    lastErrorCode: SafeErrorCodeSchema.nullable()
  })
  .strict();
export type RefundSummary = z.infer<typeof RefundSummarySchema>;

export const AdminRefundSummarySchema = RefundSummarySchema.extend({
  providerRefundId: ProviderRefundIdSchema.nullable()
}).strict();
export type AdminRefundSummary = z.infer<typeof AdminRefundSummarySchema>;

export const CustomerCancellationRefundSchema = z
  .object({
    cancellation: CancellationSummarySchema.nullable(),
    refund: RefundSummarySchema.nullable(),
    canCancel: z.boolean(),
    canReconcile: z.boolean()
  })
  .strict();
export type CustomerCancellationRefund = z.infer<
  typeof CustomerCancellationRefundSchema
>;

export const CancellationRequestSchema = z.object({}).strict();
export type CancellationRequest = z.infer<typeof CancellationRequestSchema>;

export const CancellationOutcomeSchema = z.enum([
  "accepted",
  "already_canceled",
  "refund_pending",
  "reconciliation_required",
  "refund_failed"
]);
export type CancellationOutcome = z.infer<typeof CancellationOutcomeSchema>;

export const CancellationResponseSchema = z
  .object({
    order: z.unknown(),
    outcome: CancellationOutcomeSchema
  })
  .strict();
export type CancellationResponse = z.infer<typeof CancellationResponseSchema>;

export const AdminReconciliationResponseSchema = z
  .object({
    order: z.unknown(),
    outcome: CancellationOutcomeSchema
  })
  .strict();
export type AdminReconciliationResponse = z.infer<
  typeof AdminReconciliationResponseSchema
>;

export const YooKassaRefundStatusSchema = z.enum([
  "pending",
  "succeeded",
  "canceled"
]);
export type YooKassaRefundStatus = z.infer<typeof YooKassaRefundStatusSchema>;

export const AdminRefundEventSchema = z
  .object({
    eventType: z.string().trim().min(1).max(80),
    providerStatus: YooKassaRefundStatusSchema,
    receivedAt: DateTimeSchema
  })
  .strict();
export type AdminRefundEvent = z.infer<typeof AdminRefundEventSchema>;

export const YooKassaRefundObjectSchema = z
  .object({
    id: ProviderRefundIdSchema,
    status: YooKassaRefundStatusSchema,
    amount: z
      .object({ value: z.string().regex(/^\d+\.\d{2}$/u), currency: CurrencySchema })
      .strict(),
    created_at: DateTimeSchema,
    payment_id: z.string().trim().min(1).max(160),
    description: z.string().max(2048).optional(),
    metadata: z.record(z.string().max(255), z.string().max(255)).optional(),
    cancellation_details: z
      .object({
        party: z.string().trim().min(1).max(80).optional(),
        reason: z.string().trim().min(1).max(160).optional()
      })
      .strict()
      .optional(),
    refund_authorization_details: z
      .object({ rrn: z.string().trim().min(1).max(80) })
      .strict()
      .optional(),
    receipt_registration: z.unknown().optional()
  })
  .strict();
export type YooKassaRefundObject = z.infer<typeof YooKassaRefundObjectSchema>;

export const YooKassaRefundWebhookEventSchema = z.literal("refund.succeeded");
export type YooKassaRefundWebhookEvent = z.infer<
  typeof YooKassaRefundWebhookEventSchema
>;
