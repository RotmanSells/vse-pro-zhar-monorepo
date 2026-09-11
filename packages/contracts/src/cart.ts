import { z } from "zod";

export const MAX_CART_ITEMS = 100;
export const MAX_CART_ITEM_QUANTITY = 99;
export const CART_STORAGE_VERSION = 1;

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

export const CartProductIdSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_POSTGRES_INTEGER)
  .refine(Number.isSafeInteger);

export const CartQuantitySchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_CART_ITEM_QUANTITY)
  .refine(Number.isSafeInteger);

export const CartMoneyMinorSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_SAFE_MINOR)
  .refine(Number.isSafeInteger);

export const CartItemSchema = z
  .object({
    productId: CartProductIdSchema,
    quantity: CartQuantitySchema
  })
  .strict();
export type CartItem = z.infer<typeof CartItemSchema>;

function rejectDuplicateProductIds(
  items: readonly CartItem[],
  context: z.RefinementCtx
): void {
  const seen = new Set<number>();

  items.forEach((item, index) => {
    if (seen.has(item.productId)) {
      context.addIssue({
        code: "custom",
        message: "Product IDs must be unique",
        path: [index, "productId"]
      });
      return;
    }

    seen.add(item.productId);
  });
}

function cartItemsArray(minimum: number) {
  return z
    .array(CartItemSchema)
    .min(minimum)
    .max(MAX_CART_ITEMS)
    .superRefine(rejectDuplicateProductIds);
}

export const CartItemsSchema = cartItemsArray(0);
export type CartItems = z.infer<typeof CartItemsSchema>;

export const CartStoragePayloadSchema = z
  .object({
    version: z.literal(CART_STORAGE_VERSION),
    items: cartItemsArray(0)
  })
  .strict();
export type CartStoragePayload = z.infer<typeof CartStoragePayloadSchema>;

export const CartQuoteRequestSchema = z
  .object({
    items: cartItemsArray(1)
  })
  .strict();
export type CartQuoteRequest = z.infer<typeof CartQuoteRequestSchema>;

export const CartQuoteItemSchema = z
  .object({
    productId: CartProductIdSchema,
    quantity: CartQuantitySchema,
    unitPriceMinor: CartMoneyMinorSchema,
    lineTotalMinor: CartMoneyMinorSchema
  })
  .strict();
export type CartQuoteItem = z.infer<typeof CartQuoteItemSchema>;

export const CartQuoteResponseSchema = z
  .object({
    items: z
      .array(CartQuoteItemSchema)
      .min(1)
      .max(MAX_CART_ITEMS),
    totalMinor: CartMoneyMinorSchema
  })
  .strict()
  .superRefine((response, context) => {
    rejectDuplicateProductIds(response.items, context);

    let calculatedTotal = 0;

    response.items.forEach((item, index) => {
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

    if (
      !Number.isSafeInteger(calculatedTotal) ||
      calculatedTotal !== response.totalMinor
    ) {
      context.addIssue({
        code: "custom",
        message: "Total must match the line totals",
        path: ["totalMinor"]
      });
    }
  });
export type CartQuoteResponse = z.infer<typeof CartQuoteResponseSchema>;
