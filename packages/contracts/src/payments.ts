import { z } from "zod";

import { CartMoneyMinorSchema } from "./cart.js";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const PaymentIdSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_POSTGRES_INTEGER)
  .refine(Number.isSafeInteger);
const PaymentProviderPaymentIdSchema = z.string().trim().min(1).max(160);
const PaymentCurrencySchema = z.string().regex(/^[A-Z]{3}$/u);
const PaymentDateTimeSchema = z.iso.datetime({ offset: true });

export const PaymentProviderSchema = z.literal("yookassa");
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const PaymentStatusSchema = z.enum(["pending", "succeeded", "canceled"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentProviderStatusSchema = z.enum([
  "pending",
  "waiting_for_capture",
  "succeeded",
  "canceled"
]);
export type PaymentProviderStatus = z.infer<typeof PaymentProviderStatusSchema>;

export const PaymentOrderStatusSchema = z.enum([
  "pending_payment",
  "payment_confirmed",
  "kitchen_accepted",
  "preparing",
  "ready_for_pickup",
  "completed",
  "fulfillment_problem"
]);
export type PaymentOrderStatus = z.infer<typeof PaymentOrderStatusSchema>;

export const PaymentConfirmationSchema = z
  .object({
    type: z.literal("redirect"),
    url: z.url()
  })
  .strict();
export type PaymentConfirmation = z.infer<typeof PaymentConfirmationSchema>;

export const PaymentSummarySchema = z
  .object({
    id: PaymentIdSchema,
    orderId: PaymentIdSchema,
    provider: PaymentProviderSchema,
    status: PaymentStatusSchema,
    providerStatus: PaymentProviderStatusSchema,
    amountMinor: CartMoneyMinorSchema,
    currency: PaymentCurrencySchema,
    confirmation: PaymentConfirmationSchema.nullable(),
    createdAt: PaymentDateTimeSchema,
    updatedAt: PaymentDateTimeSchema
  })
  .strict();
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;

export const PaymentCreateRequestSchema = z.object({}).strict();
export type PaymentCreateRequest = z.infer<typeof PaymentCreateRequestSchema>;

export const PaymentStateResponseSchema = z
  .object({
    order: z
      .object({
        id: PaymentIdSchema,
        status: PaymentOrderStatusSchema
      })
      .strict(),
    payment: PaymentSummarySchema.nullable()
  })
  .strict();
export type PaymentStateResponse = z.infer<typeof PaymentStateResponseSchema>;

export const PaymentCreateResponseSchema = PaymentStateResponseSchema;
export type PaymentCreateResponse = PaymentStateResponse;

export const YooKassaMoneySchema = z
  .object({
    value: z.string().regex(/^\d+\.\d{2}$/u),
    currency: PaymentCurrencySchema
  })
  .strict();
export type YooKassaMoney = z.infer<typeof YooKassaMoneySchema>;

export const YooKassaPaymentStatusSchema = PaymentProviderStatusSchema;

const YooKassaConfirmationSchema = z
  .object({
    type: z.string().trim().min(1).max(32),
    confirmation_url: z.url().optional(),
    return_url: z.url().optional(),
    locale: z.string().trim().min(1).max(16).optional(),
    confirmation_token: z.string().trim().min(1).max(500).optional()
  })
  .strict()
  .superRefine((confirmation, context) => {
    if (confirmation.type === "redirect" && confirmation.confirmation_url === undefined) {
      context.addIssue({
        code: "custom",
        message: "Redirect confirmation must contain confirmation_url",
        path: ["confirmation_url"]
      });
    }
  });

/**
 * The provider response is parsed strictly at the fields this adapter accepts.
 * Other documented YooKassa fields are listed as optional opaque values so the
 * adapter never trusts them as business state without validating the core.
 */
export const YooKassaPaymentObjectSchema = z
  .object({
    id: PaymentProviderPaymentIdSchema,
    status: YooKassaPaymentStatusSchema,
    paid: z.boolean(),
    amount: YooKassaMoneySchema,
    created_at: PaymentDateTimeSchema,
    metadata: z.record(z.string().max(255), z.string().max(255)).optional(),
    confirmation: YooKassaConfirmationSchema.optional(),
    description: z.string().max(2048).optional(),
    expires_at: PaymentDateTimeSchema.optional(),
    test: z.boolean(),
    payment_method: z.unknown().optional(),
    payment_method_data: z.unknown().optional(),
    recipient: z.unknown().optional(),
    authorization_details: z.unknown().optional(),
    captured_at: PaymentDateTimeSchema.optional(),
    refundable: z.boolean().optional(),
    refunded_amount: YooKassaMoneySchema.optional(),
    cancellation_details: z.unknown().optional(),
    income_amount: YooKassaMoneySchema.optional(),
    deal: z.unknown().optional(),
    transfers: z.unknown().optional(),
    receipt_registration: z.unknown().optional()
  })
  .strict();
export type YooKassaPaymentObject = z.infer<typeof YooKassaPaymentObjectSchema>;

export const YooKassaWebhookPayloadSchema = z
  .object({
    type: z.literal("notification"),
    event: z.string().trim().min(1).max(80),
    object: z.unknown()
  })
  .strict();
export type YooKassaWebhookPayload = z.infer<typeof YooKassaWebhookPayloadSchema>;

export const YooKassaPaymentWebhookEventSchema = z.enum([
  "payment.waiting_for_capture",
  "payment.succeeded",
  "payment.canceled"
]);
export type YooKassaPaymentWebhookEvent = z.infer<
  typeof YooKassaPaymentWebhookEventSchema
>;

export const PaymentWebhookResponseSchema = z
  .object({ received: z.literal(true) })
  .strict();
export type PaymentWebhookResponse = z.infer<typeof PaymentWebhookResponseSchema>;
