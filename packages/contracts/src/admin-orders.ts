import { z } from "zod";

import { CartMoneyMinorSchema, CartQuantitySchema } from "./cart.js";
import { FulfillmentStatusSchema, OrderStatusSchema } from "./orders.js";
import {
  PaymentProviderStatusSchema,
  PaymentStatusSchema
} from "./payments.js";
import {
  AdminRefundSummarySchema,
  CancellationSummarySchema,
  AdminRefundEventSchema
} from "./cancellation-refund.js";

const IdSchema = z.number().int().positive().max(2_147_483_647);
const DateTimeSchema = z.iso.datetime({ offset: true });
const SafeIdentifierSchema = z.string().trim().min(1).max(160);
const SafeErrorCodeSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/u);

export const AdminPaymentFilterSchema = PaymentStatusSchema.or(z.literal("none"));
export type AdminPaymentFilter = z.infer<typeof AdminPaymentFilterSchema>;
export const AdminOrderStatusSchema = OrderStatusSchema;
export const AdminFulfillmentStatusSchema = FulfillmentStatusSchema;
export type AdminOrderStatus = z.infer<typeof AdminOrderStatusSchema>;
export type AdminFulfillmentStatus = z.infer<typeof AdminFulfillmentStatusSchema>;

export const AdminOrderListItemSchema = z
  .object({
    id: IdSchema,
    status: OrderStatusSchema,
    totalMinor: CartMoneyMinorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    customer: z
      .object({ name: z.string().trim().min(1).max(160), phoneMasked: z.string().trim().min(1).max(32) })
      .strict(),
    paymentStatus: PaymentStatusSchema.nullable(),
    fulfillmentStatus: FulfillmentStatusSchema.nullable(),
    fulfillmentErrorCode: SafeErrorCodeSchema.nullable(),
    pickup: z
      .object({ locationName: z.string().trim().min(1).max(240), slotLabel: z.string().trim().min(1).max(240) })
      .strict(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema
  })
  .strict();
export type AdminOrderListItem = z.infer<typeof AdminOrderListItemSchema>;

export const AdminOrdersListResponseSchema = z
  .object({
    orders: z.array(AdminOrderListItemSchema).max(100),
    pagination: z
      .object({
        limit: z.number().int().min(1).max(100),
        offset: z.number().int().min(0),
        total: z.number().int().min(0),
        hasNext: z.boolean()
      })
      .strict()
  })
  .strict();
export type AdminOrdersListResponse = z.infer<typeof AdminOrdersListResponseSchema>;

export const AdminOrderItemSchema = z
  .object({
    productId: IdSchema,
    productName: z.string().trim().min(1).max(160),
    unitPriceMinor: CartMoneyMinorSchema,
    quantity: CartQuantitySchema,
    lineTotalMinor: CartMoneyMinorSchema
  })
  .strict();
export type AdminOrderItem = z.infer<typeof AdminOrderItemSchema>;

export const AdminOrderHistoryEntrySchema = z
  .object({ status: OrderStatusSchema, createdAt: DateTimeSchema })
  .strict();
export type AdminOrderHistoryEntry = z.infer<typeof AdminOrderHistoryEntrySchema>;

export const AdminPaymentSchema = z
  .object({
    id: IdSchema,
    provider: z.literal("yookassa"),
    status: PaymentStatusSchema,
    providerStatus: PaymentProviderStatusSchema,
    amountMinor: CartMoneyMinorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema
  })
  .strict();
export type AdminPayment = z.infer<typeof AdminPaymentSchema>;

export const AdminFulfillmentSchema = z
  .object({
    status: FulfillmentStatusSchema,
    errorCode: SafeErrorCodeSchema.nullable(),
    attemptCount: z.number().int().min(0),
    nextAttemptAt: DateTimeSchema,
    lastAttemptAt: DateTimeSchema.nullable(),
    updatedAt: DateTimeSchema,
    correlationId: SafeIdentifierSchema,
    providerOrderId: SafeIdentifierSchema.nullable(),
    commandId: SafeIdentifierSchema.nullable()
  })
  .strict();
export type AdminFulfillment = z.infer<typeof AdminFulfillmentSchema>;

export const AdminOrderDetailSchema = z
  .object({
    id: IdSchema,
    status: OrderStatusSchema,
    totalMinor: CartMoneyMinorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    customer: z
      .object({ id: IdSchema, name: z.string().trim().min(1).max(160), phone: z.string().trim().min(1).max(32) })
      .strict(),
    pickup: z
      .object({
        locationId: z.string().trim().min(1).max(160),
        locationName: z.string().trim().min(1).max(240),
        address: z.string().trim().min(1).max(240),
        timezone: z.string().trim().min(1).max(80),
        slotId: z.string().trim().min(1).max(160),
        slotLabel: z.string().trim().min(1).max(240),
        startsAt: DateTimeSchema,
        endsAt: DateTimeSchema
      })
      .strict(),
    items: z.array(AdminOrderItemSchema).min(1).max(100),
    payment: AdminPaymentSchema.nullable(),
    fulfillment: AdminFulfillmentSchema.nullable(),
    history: z.array(AdminOrderHistoryEntrySchema).min(1).max(100),
    cancellation: CancellationSummarySchema.nullable().optional(),
    refund: AdminRefundSummarySchema.nullable().optional(),
    refundEvents: z.array(AdminRefundEventSchema).max(100).optional()
  })
  .strict();
export type AdminOrderDetail = z.infer<typeof AdminOrderDetailSchema>;

export const AdminFulfillmentRecoveryResponseSchema = z
  .object({
    order: AdminOrderDetailSchema,
    recovery: z
      .object({ mode: z.enum(["create", "reconcile", "already_in_progress"]) })
      .strict()
  })
  .strict();
export type AdminFulfillmentRecoveryResponse = z.infer<typeof AdminFulfillmentRecoveryResponseSchema>;
