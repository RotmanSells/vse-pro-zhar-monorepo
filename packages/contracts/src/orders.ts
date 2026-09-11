import { z } from "zod";

import {
  CartItemsSchema,
  CartMoneyMinorSchema,
  CartProductIdSchema,
  CartQuantitySchema,
  MAX_CART_ITEMS
} from "./cart.js";
import {
  CheckoutPickupSelectionSchema,
  CheckoutSelectedPickupSchema
} from "./checkout.js";
import { PaymentSummarySchema } from "./payments.js";
import { CustomerCancellationRefundSchema } from "./cancellation-refund.js";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const OrderIdSchema = CartProductIdSchema.max(MAX_POSTGRES_INTEGER);
const OrderCurrencySchema = z.string().regex(/^[A-Z]{3}$/u);
const OrderDateTimeSchema = z.iso.datetime({ offset: true });

export const OrderStatusSchema = z.enum([
  "pending_payment",
  "payment_confirmed",
  "kitchen_accepted",
  "preparing",
  "ready_for_pickup",
  "completed",
  "fulfillment_problem",
  "canceled"
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const FulfillmentStatusSchema = z.enum([
  "pending",
  "creating",
  "command_pending",
  "submitted",
  "failed"
]);
export type FulfillmentStatus = z.infer<typeof FulfillmentStatusSchema>;

export const FulfillmentSummarySchema = z
  .object({
    status: FulfillmentStatusSchema,
    updatedAt: OrderDateTimeSchema
  })
  .strict();
export type FulfillmentSummary = z.infer<typeof FulfillmentSummarySchema>;

export const OrderCreateRequestSchema = z
  .object({
    items: CartItemsSchema.min(1),
    pickup: CheckoutPickupSelectionSchema,
    redemptionId: CartProductIdSchema.max(MAX_POSTGRES_INTEGER).optional()
  })
  .strict();
export type OrderCreateRequest = z.infer<typeof OrderCreateRequestSchema>;

export const OrderItemSchema = z
  .object({
    productId: CartProductIdSchema,
    productName: z.string().trim().min(1).max(160),
    unitPriceMinor: CartMoneyMinorSchema,
    quantity: CartQuantitySchema,
    lineTotalMinor: CartMoneyMinorSchema
  })
  .strict();
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSummarySchema = z
  .object({
    id: OrderIdSchema,
    status: OrderStatusSchema,
    totalMinor: CartMoneyMinorSchema,
    currency: OrderCurrencySchema,
    pickup: CheckoutSelectedPickupSchema,
    createdAt: OrderDateTimeSchema,
    updatedAt: OrderDateTimeSchema
  })
  .strict();
export type OrderSummary = z.infer<typeof OrderSummarySchema>;

export const OrderResponseSchema = OrderSummarySchema.extend({
  items: z.array(OrderItemSchema).min(1).max(MAX_CART_ITEMS),
  subtotalMinor: CartMoneyMinorSchema.optional(),
  discountMinor: CartMoneyMinorSchema.optional(),
  loyaltyRedemption: z.object({
    id: OrderIdSchema,
    rewardCode: z.string().trim().min(1).max(80),
    rewardName: z.string().trim().min(1).max(160),
    discountMinor: CartMoneyMinorSchema.positive().max(MAX_POSTGRES_INTEGER),
    status: z.literal("succeeded")
  }).strict().optional(),
  payment: PaymentSummarySchema.nullable().optional(),
  fulfillment: FulfillmentSummarySchema.nullable().optional(),
  cancellationRefund: CustomerCancellationRefundSchema.optional()
})
  .strict()
  .superRefine((order, context) => {
    const productIds = new Set<number>();
    let totalMinor = 0;

    order.items.forEach((item, index) => {
      if (productIds.has(item.productId)) {
        context.addIssue({
          code: "custom",
          message: "Product IDs must be unique",
          path: ["items", index, "productId"]
        });
      }
      productIds.add(item.productId);

      const lineTotal = item.unitPriceMinor * item.quantity;
      if (!Number.isSafeInteger(lineTotal) || lineTotal !== item.lineTotalMinor) {
        context.addIssue({
          code: "custom",
          message: "Line total must match quantity and unit price",
          path: ["items", index, "lineTotalMinor"]
        });
      }
      totalMinor += item.lineTotalMinor;
    });

    const subtotalMinor = order.subtotalMinor ?? totalMinor;
    const discountMinor = order.discountMinor ?? 0;
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor !== totalMinor) {
      context.addIssue({ code: "custom", message: "Subtotal must match the line totals", path: ["subtotalMinor"] });
    }
    if (!Number.isSafeInteger(discountMinor) || discountMinor < 0 || discountMinor > subtotalMinor || subtotalMinor - discountMinor !== order.totalMinor || (order.loyaltyRedemption !== undefined && order.loyaltyRedemption.discountMinor !== discountMinor)) {
      context.addIssue({
        code: "custom",
        message: "Total must match subtotal and discount",
        path: ["totalMinor"]
      });
    }
  });
export type OrderResponse = z.infer<typeof OrderResponseSchema>;

export const CreatedOrderResponseSchema = OrderResponseSchema;
export type CreatedOrderResponse = OrderResponse;

export const OrdersListResponseSchema = z
  .object({
    orders: z.array(OrderSummarySchema).max(100)
  })
  .strict();
export type OrdersListResponse = z.infer<typeof OrdersListResponseSchema>;

export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  }))
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(255));
