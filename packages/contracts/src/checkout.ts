import { z } from "zod";

import {
  CartItemsSchema,
  CartMoneyMinorSchema,
  MAX_CART_ITEMS,
  CartProductIdSchema,
  CartQuantitySchema
} from "./cart.js";
import { CustomerProfileSchema } from "./auth.js";

const MAX_CHECKOUT_LOCATIONS = 10;
const MAX_CHECKOUT_SLOTS = 100;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const IsoDateTimeSchema = z.iso.datetime({ offset: true });

const PickupIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/u);

const PickupTextSchema = z.string().trim().min(1).max(240);

export const PickupSlotSchema = z
  .object({
    id: PickupIdSchema,
    label: PickupTextSchema,
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema
  })
  .strict()
  .refine(
    (slot) => new Date(slot.endsAt).getTime() > new Date(slot.startsAt).getTime(),
    { message: "Pickup slot must end after it starts", path: ["endsAt"] }
  );
export type PickupSlot = z.infer<typeof PickupSlotSchema>;

export const PickupLocationSchema = z
  .object({
    id: PickupIdSchema,
    name: PickupTextSchema,
    address: PickupTextSchema,
    timezone: z.string().trim().min(1).max(80),
    slots: z.array(PickupSlotSchema).min(1).max(MAX_CHECKOUT_SLOTS)
  })
  .strict();
export type PickupLocation = z.infer<typeof PickupLocationSchema>;

export const CheckoutOptionsResponseSchema = z
  .object({
    locations: z
      .array(PickupLocationSchema)
      .min(1)
      .max(MAX_CHECKOUT_LOCATIONS)
  })
  .strict();
export type CheckoutOptionsResponse = z.infer<
  typeof CheckoutOptionsResponseSchema
>;

export const CheckoutPickupSelectionSchema = z
  .object({
    locationId: PickupIdSchema,
    slotId: PickupIdSchema
  })
  .strict();
export type CheckoutPickupSelection = z.infer<
  typeof CheckoutPickupSelectionSchema
>;

const CheckoutItemsSchema = CartItemsSchema.min(1);

export const CheckoutQuoteRequestSchema = z
  .object({
    items: CheckoutItemsSchema,
    pickup: CheckoutPickupSelectionSchema,
    redemptionId: CartProductIdSchema.max(MAX_POSTGRES_INTEGER).optional()
  })
  .strict();
export type CheckoutQuoteRequest = z.infer<typeof CheckoutQuoteRequestSchema>;

export const CheckoutQuoteItemSchema = z
  .object({
    productId: CartProductIdSchema.max(MAX_POSTGRES_INTEGER),
    productName: z.string().trim().min(1).max(160),
    quantity: CartQuantitySchema,
    unitPriceMinor: CartMoneyMinorSchema,
    lineTotalMinor: CartMoneyMinorSchema
  })
  .strict();
export type CheckoutQuoteItem = z.infer<typeof CheckoutQuoteItemSchema>;

const CheckoutSelectedPickupLocationSchema = PickupLocationSchema.omit({
  slots: true
}).strict();

export const CheckoutSelectedPickupSchema = z
  .object({
    location: CheckoutSelectedPickupLocationSchema,
    slot: PickupSlotSchema
  })
  .strict();
export type CheckoutSelectedPickup = z.infer<
  typeof CheckoutSelectedPickupSchema
>;

export const CheckoutQuoteResponseSchema = z
  .object({
    customer: CustomerProfileSchema,
    items: z
      .array(CheckoutQuoteItemSchema)
      .min(1)
      .max(MAX_CART_ITEMS),
    subtotalMinor: CartMoneyMinorSchema.optional(),
    discountMinor: CartMoneyMinorSchema.optional(),
    totalMinor: CartMoneyMinorSchema,
    loyaltyRedemption: z
      .object({
        id: CartProductIdSchema.max(MAX_POSTGRES_INTEGER),
        rewardCode: z.string().trim().min(1).max(80),
        rewardName: z.string().trim().min(1).max(160),
        discountMinor: CartMoneyMinorSchema.positive().max(MAX_POSTGRES_INTEGER),
        status: z.literal("pending")
      })
      .strict()
      .optional(),
    pickup: CheckoutSelectedPickupSchema,
    confirmationText: z.string().trim().min(1).max(300)
  })
  .strict()
  .superRefine((response, context) => {
    const productIds = new Set<number>();
    let calculatedTotal = 0;

    response.items.forEach((item, index) => {
      if (productIds.has(item.productId)) {
        context.addIssue({
          code: "custom",
          message: "Product IDs must be unique",
          path: ["items", index, "productId"]
        });
      }
      productIds.add(item.productId);

      const calculatedLineTotal = item.unitPriceMinor * item.quantity;
      if (
        !Number.isSafeInteger(calculatedLineTotal) ||
        calculatedLineTotal !== item.lineTotalMinor
      ) {
        context.addIssue({
          code: "custom",
          message: "Line total must match quantity and unit price",
          path: ["items", index, "lineTotalMinor"]
        });
      }

      calculatedTotal += item.lineTotalMinor;
    });

    const subtotalMinor = response.subtotalMinor ?? calculatedTotal;
    const discountMinor = response.discountMinor ?? 0;
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor !== calculatedTotal) {
      context.addIssue({ code: "custom", message: "Subtotal must match the line totals", path: ["subtotalMinor"] });
    }
    if (!Number.isSafeInteger(discountMinor) || discountMinor < 0 || discountMinor > subtotalMinor || subtotalMinor - discountMinor !== response.totalMinor) {
      context.addIssue({
        code: "custom",
        message: "Total must match subtotal and discount",
        path: ["totalMinor"]
      });
    }
  });
export type CheckoutQuoteResponse = z.infer<typeof CheckoutQuoteResponseSchema>;

export const OperationalAvailabilityStatusSchema = z.enum([
  "available",
  "unavailable",
  "unknown",
  "stale"
]);
export type OperationalAvailabilityStatus = z.infer<
  typeof OperationalAvailabilityStatusSchema
>;

export const OperationalAvailabilityRecordSchema = z
  .object({
    productId: CartProductIdSchema,
    iikoProductId: z.string().trim().min(1).max(200).nullable(),
    status: OperationalAvailabilityStatusSchema,
    checkedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.status === "available" &&
      (record.iikoProductId === null || record.checkedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "An available product must have an iiko mapping and check time",
        path: ["status"]
      });
    }
  });
export type OperationalAvailabilityRecord = z.infer<
  typeof OperationalAvailabilityRecordSchema
>;
